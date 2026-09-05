import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assessFacadeComposition, bearingDegrees, extentPolygon, fuseSiteModel, polygonCentroid, rankStreetImages, selectDistinctStreetImages, type BuildingFeature, type Coordinate, type StreetImageCandidate, type VisualFacadeComponent, type VisualObservation } from "../packages/site-twin-core/src/index.ts";
import { getLandCoverSamples, getLosAngelesSiteGeometry } from "../packages/provider-lacounty/src/index.ts";
import { findKartaViewImages } from "../packages/provider-kartaview/src/index.ts";
import { downloadGoogleStreetViewFrame, findGoogleStreetViewImages } from "../packages/provider-google-streetview-research/src/index.ts";
import { analyzeFacadeBandsWithOllama, analyzeFacadeRegionWithOllama, analyzeImageWithOllama, cropImageRegion, locateTargetHouseWithOllama, type FacadeRegionPosition, type TargetHouseRegion } from "../packages/provider-ollama/src/index.ts";
import { geocodeAddress, getNearbyStreetContext } from "../packages/provider-openstreetmap/src/index.ts";
import { getElevation, sampleTerrainGrid } from "../packages/provider-usgs/src/index.ts";

interface CliOptions {
  address: string;
  latitude?: number;
  longitude?: number;
  output: string;
  analysisOutput?: string;
  radiusM: number;
  imageLimit: number;
  model: string;
  noVision: boolean;
  imageryProviders: string[];
}

function argsToOptions(argv: string[]): CliOptions {
  const read = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const address = read("--address") ?? "2629 Corralitas Dr, Los Angeles, CA 90039";
  const latitude = read("--latitude");
  const longitude = read("--longitude");
  const output = read("--output") ?? "apps/site-twin-demo/public/site-twin.json";
  const radius = Number(read("--radius") ?? 500);
  const imageLimit = Number(read("--images") ?? 4);
  return {
    address,
    latitude: latitude == null ? undefined : Number(latitude),
    longitude: longitude == null ? undefined : Number(longitude),
    output,
    analysisOutput: read("--analysis-output") ?? `${output.replace(/\.json$/i, "")}.analysis.json`,
    radiusM: Number.isFinite(radius) ? radius : 500,
    imageLimit: Number.isFinite(imageLimit) ? imageLimit : 4,
    model: read("--model") ?? process.env.SITE_TWIN_VISION_MODEL ?? "gemma3:4b",
    noVision: argv.includes("--no-vision"),
    imageryProviders: (read("--imagery") ?? "google,kartaview").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
  };
}

async function targetCoordinate(options: CliOptions): Promise<Coordinate> {
  if (typeof options.latitude === "number" && Number.isFinite(options.latitude) && typeof options.longitude === "number" && Number.isFinite(options.longitude)) {
    return { latitude: options.latitude, longitude: options.longitude };
  }
  const geocode = await geocodeAddress(options.address);
  console.log(`Geocoded: ${geocode.latitude.toFixed(6)}, ${geocode.longitude.toFixed(6)} via ${geocode.provider}`);
  return { latitude: geocode.latitude, longitude: geocode.longitude };
}

async function downloadImage(image: StreetImageCandidate, directory: string, fovDeg?: number) {
  if (image.provider === "google-streetview-research") {
    const bytes = await downloadGoogleStreetViewFrame(image, { fovDeg });
    const filename = join(directory, `${image.provider}-${image.id}.jpg`);
    await writeFile(filename, bytes);
    return { filename, bytes };
  }

  const urls = [...new Set([image.imageUrl, image.thumbnailUrl].filter((value): value is string => Boolean(value)))];
  let lastStatus = 0;
  for (const url of urls) {
    const response = await fetch(url);
    lastStatus = response.status;
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const filename = join(directory, `${image.provider}-${image.id}.jpg`);
    await writeFile(filename, bytes);
    return { filename, bytes };
  }
  throw new Error(`image download ${image.id} failed with ${lastStatus || "no usable URL"}`);
}

function signedAngularOffset(angle: number, center: number) {
  return ((angle - center + 540) % 360) - 180;
}

function facadeAngularExtent(image: StreetImageCandidate, building: BuildingFeature) {
  const centerHeading = image.bearingToTargetDeg ?? bearingDegrees(image, polygonCentroid(building.polygon));
  const offsets = building.polygon
    .map(([longitude, latitude]) => signedAngularOffset(bearingDegrees(image, { longitude, latitude }), centerHeading))
    .filter((offset) => Math.abs(offset) < 85);
  if (offsets.length < 2) return { centerHeading, minOffset: -18, maxOffset: 18, spanDeg: 36 };
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  const spanDeg = Math.max(18, Math.min(70, maxOffset - minOffset));
  return { centerHeading, minOffset, maxOffset, spanDeg };
}

function regionPosition(normalizedCenter: number): FacadeRegionPosition {
  if (normalizedCenter < 0.36) return "left";
  if (normalizedCenter > 0.64) return "right";
  return "center";
}

function componentTop(relativeHeight: "low" | "medium" | "tall") {
  if (relativeHeight === "low") return 0.66;
  if (relativeHeight === "tall") return 1;
  return 0.82;
}

function componentSetback(projection: "projects" | "flush" | "setback") {
  if (projection === "projects") return "none" as const;
  if (projection === "setback") return "moderate" as const;
  return "slight" as const;
}

function mergeTargetArchitecture(contextObservation: VisualObservation, targetObservation: VisualObservation): VisualObservation {
  return {
    ...contextObservation,
    visible: targetObservation.visible || contextObservation.visible,
    confidence: Math.max(contextObservation.confidence, targetObservation.confidence),
    storiesApprox: targetObservation.storiesApprox ?? contextObservation.storiesApprox,
    roof: targetObservation.roof ?? contextObservation.roof,
    massing: targetObservation.massing ?? contextObservation.massing,
    facadeComposition: targetObservation.facadeComposition ?? contextObservation.facadeComposition,
    facades: targetObservation.facades.length ? targetObservation.facades : contextObservation.facades,
    site: contextObservation.site,
    notes: [...new Set([...(contextObservation.notes ?? []), ...(targetObservation.notes ?? [])])],
  };
}

function mergeTargetArchitecture(fullFrame: VisualObservation, targetCrop: VisualObservation): VisualObservation {
  return {
    ...fullFrame,
    visible: fullFrame.visible || targetCrop.visible,
    confidence: Math.max(fullFrame.confidence, targetCrop.confidence),
    storiesApprox: targetCrop.storiesApprox ?? fullFrame.storiesApprox,
    roof: targetCrop.roof ?? fullFrame.roof,
    massing: targetCrop.massing ?? fullFrame.massing,
    facadeComposition: targetCrop.facadeComposition ?? fullFrame.facadeComposition,
    facades: targetCrop.facades.length ? targetCrop.facades : fullFrame.facades,
    // Site context belongs to the uncropped street frame. A tight building crop is
    // intentionally not allowed to erase retaining walls, stairs, curb, or vegetation.
    site: fullFrame.site,
    notes: [...new Set([...(fullFrame.notes ?? []), ...(targetCrop.notes ?? [])])],
  };
}

async function refinePrimaryFacade(
  houseBytes: Buffer,
  modelName: string,
  localizationConfidence = 1,
) {
  const bands = await analyzeFacadeBandsWithOllama(houseBytes.toString("base64"), { model: modelName });
  if (bands.length < 2) return undefined;

  const components: VisualFacadeComponent[] = [];
  let cursor = 0;
  for (const band of bands) {
    const x = cursor + band.widthFraction / 2;
    const position = regionPosition(x);
    const regionBytes = await cropImageRegion(houseBytes, {
      x: cursor,
      y: 0,
      width: band.widthFraction,
      height: 1,
    }, { paddingFraction: 0.18 });
    const region = await analyzeFacadeRegionWithOllama(position, regionBytes.toString("base64"), { model: modelName });
    const relativeHeight = region.relativeHeight ?? band.relativeHeight;
    const projection = region.projection ?? band.projection;
    components.push({
      kind: region.kind,
      x,
      width: band.widthFraction,
      bottom: 0.04,
      top: componentTop(relativeHeight),
      depthFraction: region.kind === "tower" ? 0.62 : 0.72,
      setback: componentSetback(projection),
      roofType: "flat",
      color: region.wallColor,
      material: region.wallMaterial,
      accentColor: region.accentColor,
      accentMaterial: region.accentMaterial,
      windowCount: region.windowCount,
      windowOrientation: region.windowOrientation,
      glazing: region.glazing,
      hasDoor: region.hasDoor,
      deckLocation: region.deckLocation,
      railColor: region.railColor,
      confidence: Math.min(0.98, (band.confidence + region.confidence + localizationConfidence) / 3),
    });
    console.log(`  ${position} facade: ${region.kind} ${region.wallColor ?? "unknown"}/${region.wallMaterial ?? "unknown"} height=${relativeHeight} windows=${region.windowCount ?? "?"} deck=${region.deckLocation ?? "unknown"}`);
    cursor += band.widthFraction;
  }
  const confidence = components.reduce((sum, component) => sum + component.confidence, 0) / components.length;
  const composition = { components, confidence };
  const quality = assessFacadeComposition(composition);
  console.log(`  facade quality: coverage=${(quality.horizontalCoverage * 100).toFixed(0)}% span=${quality.leftEdge.toFixed(2)}..${quality.rightEdge.toFixed(2)} roof=${quality.maxTop.toFixed(2)} score=${quality.structuralScore.toFixed(3)} ${quality.acceptable ? "PASS" : `REJECT (${quality.reasons.join("; ")})`}`);
  return { composition, quality };
}

async function main() {
  const options = argsToOptions(process.argv.slice(2));
  const point = await targetCoordinate(options);
  console.log(`Target: ${options.address}`);

  const countyGeometry = await getLosAngelesSiteGeometry(point);
  const contextPolygon = extentPolygon([
    ...(countyGeometry.parcel ? [countyGeometry.parcel.polygon] : []),
    ...countyGeometry.buildings.map((building) => building.polygon),
  ]);
  const terrainPolygon = contextPolygon.length ? contextPolygon : countyGeometry.parcel?.polygon ?? countyGeometry.buildings[0]?.polygon ?? [];
  const [streetContext, terrain, landCover, buildingGroundElevations] = await Promise.all([
    getNearbyStreetContext(point).catch((error) => {
      console.warn(`Street context unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { roads: [], sidewalks: [] };
    }),
    sampleTerrainGrid(terrainPolygon, 9, 18).catch((error) => {
      console.warn(`Terrain unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
    getLandCoverSamples(terrainPolygon, 64, 12).catch((error) => {
      console.warn(`Land cover unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { samples: [], provenance: undefined };
    }),
    Promise.all(countyGeometry.buildings.map(async (building) => {
      const center = polygonCentroid(building.polygon);
      try {
        const sample = await getElevation(center);
        return [building.id, sample.elevationM] as const;
      } catch {
        return [building.id, undefined] as const;
      }
    })),
  ]);

  const terrainProvenance = terrain.find((sample) => sample.provenance)?.provenance;
  const geometry = {
    ...countyGeometry,
    buildings: countyGeometry.buildings.map((building) => ({
      ...building,
      groundElevationM: buildingGroundElevations.find(([id]) => id === building.id)?.[1],
    })),
    roads: streetContext.roads,
    sidewalks: streetContext.sidewalks,
    terrain,
    groundCover: landCover.samples,
    provenance: [
      ...countyGeometry.provenance,
      ...streetContext.roads.flatMap((road) => road.provenance ? [road.provenance] : []),
      ...streetContext.sidewalks.flatMap((sidewalk) => sidewalk.provenance ? [sidewalk.provenance] : []),
      ...(terrainProvenance ? [terrainProvenance] : []),
      ...(landCover.provenance ? [landCover.provenance] : []),
    ],
  };

  const primary = geometry.buildings.find((building) => building.id === geometry.primaryBuildingId) ?? geometry.buildings[0];
  console.log(`Parcel: ${geometry.parcel?.id ?? "not found"}`);
  console.log(`Buildings: ${geometry.buildings.length}`);
  console.log(`Primary building: ${primary?.id ?? "not found"}${primary?.heightM ? `, ${primary.heightM.toFixed(2)} m measured height` : ""}`);
  if (geometry.terrain.length) {
    const elevations = geometry.terrain.map((sample) => sample.elevationM);
    console.log(`Terrain: ${geometry.terrain.length} samples, ${(Math.max(...elevations) - Math.min(...elevations)).toFixed(2)} m local relief`);
  }
  if (geometry.groundCover.length) {
    const counts = Object.fromEntries([...new Set(geometry.groundCover.map((sample) => sample.className))].map((className) => [className, geometry.groundCover.filter((sample) => sample.className === className).length]));
    console.log(`Ground cover: ${geometry.groundCover.length} samples ${JSON.stringify(counts)}`);
  }

  const candidatePoolLimit = Math.max(options.imageLimit * 3, 8);
  const discovered: StreetImageCandidate[] = [];

  if (options.imageryProviders.includes("google")) {
    const google = await findGoogleStreetViewImages(point, {
      radiusM: options.radiusM,
      selectedLimit: candidatePoolLimit,
      candidateLimit: Math.max(candidatePoolLimit * 4, 30),
    }).catch((error) => {
      console.warn(`Google Street View research discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return [] as StreetImageCandidate[];
    });
    discovered.push(...google);
  }

  if (options.imageryProviders.includes("kartaview")) {
    const kartaView = await findKartaViewImages(point, {
      radiusM: options.radiusM,
      selectedLimit: candidatePoolLimit,
    }).catch((error) => {
      console.warn(`KartaView discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return [] as StreetImageCandidate[];
    });
    discovered.push(...kartaView);
  }

  const candidatePool = selectDistinctStreetImages(
    rankStreetImages(discovered, point, options.radiusM),
    candidatePoolLimit,
    10,
  );
  console.log(`Street-image candidate pool: ${candidatePool.length}`);
  candidatePool.forEach((image, index) => console.log(`  ${index + 1}. ${image.provider}:${image.id} score=${(image.score ?? 0).toFixed(3)} distance=${(image.distanceToTargetM ?? 0).toFixed(1)}m`));

  const observations: VisualObservation[] = [];
  const rejected: Array<{ imageId: string; error: string }> = [];
  const localizedTargets: Array<{ imageId: string; region: TargetHouseRegion }> = [];
  const attemptedImagery: StreetImageCandidate[] = [];
  const workDir = join(tmpdir(), `officeadmin-site-twin-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  try {
    if (!options.noVision) {
      let usefulCount = 0;
      for (const image of candidatePool) {
        if (usefulCount >= options.imageLimit) break;
        attemptedImagery.push(image);
        try {
          const isPrimaryResearchView = image.provider === "google-streetview-research" && attemptedImagery.length === 1 && Boolean(primary);
          const centeredFov = isPrimaryResearchView && primary ? Math.max(44, Math.min(58, facadeAngularExtent(image, primary).spanDeg * 1.02)) : undefined;
          const { bytes } = await downloadImage(image, workDir, centeredFov);
          console.log(`Analyzing ${image.provider}:${image.id} with ${options.model}${centeredFov ? ` fov=${centeredFov.toFixed(1)}deg` : ""}...`);
          const targetDescription = image.provider === "google-streetview-research"
            ? `Target address is ${options.address}. This image was programmatically cropped to face the target parcel, so the target should be near the center of frame. Do not describe a different building if the target is occluded.${isPrimaryResearchView ? " For facadeComposition, cover the complete visible target-house width and keep primary masses separate where facade plane, height, or dominant wall material clearly changes." : ""}`
            : `Target address is ${options.address}. The target is the property near the target coordinate, not merely any nearby house.`;
          let observation = await analyzeImageWithOllama(image.id, bytes.toString("base64"), {
            model: options.model,
            context: {
              targetBearingDeg: image.bearingToTargetDeg,
              expectedBuildingHeightM: primary?.heightM,
              targetDescription,
            },
          });
          if (isPrimaryResearchView && primary) {
            try {
              const region = await locateTargetHouseWithOllama(bytes.toString("base64"), {
                model: options.model,
                context: {
                  targetBearingDeg: image.bearingToTargetDeg,
                  expectedBuildingHeightM: primary.heightM,
                  targetDescription,
                },
              });
              localizedTargets.push({ imageId: image.id, region });
              console.log(`  target bbox: x=${region.x.toFixed(3)} y=${region.y.toFixed(3)} w=${region.width.toFixed(3)} h=${region.height.toFixed(3)} confidence=${region.confidence.toFixed(2)} visible=${region.visible}`);
              if (region.visible && region.confidence >= 0.45) {
                const targetBytes = await cropImageRegion(bytes, region, { paddingFraction: 0.06 });
                const targetObservation = await analyzeImageWithOllama(image.id, targetBytes.toString("base64"), {
                  model: options.model,
                  context: {
                    expectedBuildingHeightM: primary.heightM,
                    targetDescription: `This image is already cropped tightly around the target building at ${options.address}. Analyze only this building. Reconstruct the complete visible facade from left edge to right edge. Keep large architectural masses separate where plane, height, or dominant material clearly changes. Edge vegetation may remain from occlusion, but it is not architecture.`,
                  },
                });
                observation = mergeTargetArchitecture(observation, targetObservation);
                if (targetObservation.visible && targetObservation.confidence >= 0.45) {
                  const targetQuality = assessFacadeComposition(targetObservation.facadeComposition);
                  const refined = await refinePrimaryFacade(targetBytes, options.model, region.confidence);
                  const refinedWins = refined?.quality.acceptable
                    && (!targetQuality.acceptable || refined.quality.structuralScore > targetQuality.structuralScore);
                  if (refinedWins && refined) {
                    observation.facadeComposition = refined.composition;
                    console.log(`  selected focused facade score=${refined.quality.structuralScore.toFixed(3)} over target-crop=${targetQuality.structuralScore.toFixed(3)}`);
                  } else if (targetQuality.acceptable) {
                    observation.facadeComposition = targetObservation.facadeComposition;
                    console.log(`  selected target-crop facade score=${targetQuality.structuralScore.toFixed(3)} over focused=${refined?.quality.structuralScore.toFixed(3) ?? "n/a"}`);
                  } else {
                    observation.facadeComposition = undefined;
                    const reasons = refined?.quality.reasons.length ? refined.quality.reasons : targetQuality.reasons;
                    console.warn(`  refusing incomplete facade composition: ${reasons.join("; ") || "no acceptable target-facade parse"}`);
                  }
                }
              }
            } catch (error) {
              console.warn(`  target-first facade refinement failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          observations.push(observation);
          if (observation.visible && observation.confidence >= 0.45) usefulCount += 1;
          console.log(`  visible=${observation.visible} confidence=${observation.confidence.toFixed(2)} roof=${observation.roof?.type ?? "unknown"} useful=${usefulCount}/${options.imageLimit}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rejected.push({ imageId: image.id, error: message });
          console.warn(`  rejected ${image.provider}:${image.id}: ${message}`);
        }
      }
    } else {
      attemptedImagery.push(...candidatePool.slice(0, options.imageLimit));
      console.log("Vision disabled by --no-vision");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const imagery = attemptedImagery;
  const model = fuseSiteModel(options.address, geometry, imagery, observations);
  if (rejected.length) model.warnings.push(`${rejected.length} imagery observations failed or were rejected.`);

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.output}`);

  if (options.analysisOutput) {
    const analysis = {
      generatedAt: new Date().toISOString(),
      target: { address: options.address, ...point },
      options: {
        radiusM: options.radiusM,
        imageLimit: options.imageLimit,
        model: options.model,
        visionEnabled: !options.noVision,
        imageryProviders: options.imageryProviders,
      },
      primaryBuilding: primary,
      rankedImagery: candidatePool,
      attemptedImagery: imagery,
      observations,
      localizedTargets,
      rejected,
      warnings: model.warnings,
    };
    await mkdir(dirname(options.analysisOutput), { recursive: true });
    await writeFile(options.analysisOutput, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.analysisOutput}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
