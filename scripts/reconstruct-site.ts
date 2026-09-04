import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fuseSiteModel, rankStreetImages, selectDistinctStreetImages, type Coordinate, type StreetImageCandidate, type VisualObservation } from "../packages/site-twin-core/src/index.ts";
import { getLandCoverSamples, getLosAngelesSiteGeometry } from "../packages/provider-lacounty/src/index.ts";
import { findKartaViewImages } from "../packages/provider-kartaview/src/index.ts";
import { downloadGoogleStreetViewFrame, findGoogleStreetViewImages } from "../packages/provider-google-streetview-research/src/index.ts";
import { analyzeImageWithOllama } from "../packages/provider-ollama/src/index.ts";
import { geocodeAddress, getNearbyStreetContext } from "../packages/provider-openstreetmap/src/index.ts";
import { sampleTerrainGrid } from "../packages/provider-usgs/src/index.ts";

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

async function downloadImage(image: StreetImageCandidate, directory: string) {
  if (image.provider === "google-streetview-research") {
    const bytes = await downloadGoogleStreetViewFrame(image);
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

async function main() {
  const options = argsToOptions(process.argv.slice(2));
  const point = await targetCoordinate(options);
  console.log(`Target: ${options.address}`);

  const countyGeometry = await getLosAngelesSiteGeometry(point);
  const terrainPolygon = countyGeometry.parcel?.polygon ?? countyGeometry.buildings[0]?.polygon ?? [];
  const [streetContext, terrain, landCover] = await Promise.all([
    getNearbyStreetContext(point).catch((error) => {
      console.warn(`Street context unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { roads: [], sidewalks: [] };
    }),
    sampleTerrainGrid(terrainPolygon, 4, 18).catch((error) => {
      console.warn(`Terrain unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
    getLandCoverSamples(terrainPolygon, 24, 16).catch((error) => {
      console.warn(`Land cover unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { samples: [], provenance: undefined };
    }),
  ]);

  const terrainProvenance = terrain.find((sample) => sample.provenance)?.provenance;
  const geometry = {
    ...countyGeometry,
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
          const { bytes } = await downloadImage(image, workDir);
          console.log(`Analyzing ${image.provider}:${image.id} with ${options.model}...`);
          const targetDescription = image.provider === "google-streetview-research"
            ? `Target address is ${options.address}. This image was programmatically cropped to face the target parcel, so the target should be near the center of frame. Do not describe a different building if the target is occluded.`
            : `Target address is ${options.address}. The target is the property near the target coordinate, not merely any nearby house.`;
          const observation = await analyzeImageWithOllama(image.id, bytes.toString("base64"), {
            model: options.model,
            context: {
              targetBearingDeg: image.bearingToTargetDeg,
              expectedBuildingHeightM: primary?.heightM,
              targetDescription,
            },
          });
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
