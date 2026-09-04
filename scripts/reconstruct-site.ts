import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fuseSiteModel, type Coordinate, type StreetImageCandidate, type VisualObservation } from "../packages/site-twin-core/src/index.ts";
import { getLosAngelesSiteGeometry } from "../packages/provider-lacounty/src/index.ts";
import { findKartaViewImages } from "../packages/provider-kartaview/src/index.ts";
import { analyzeImageWithOllama } from "../packages/provider-ollama/src/index.ts";
import { geocodeAddress, getNearbyStreetContext } from "../packages/provider-openstreetmap/src/index.ts";

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
  const response = await fetch(image.imageUrl);
  if (!response.ok) throw new Error(`image download ${image.id} failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = join(directory, `${image.provider}-${image.id}.jpg`);
  await writeFile(filename, bytes);
  return { filename, bytes };
}

async function main() {
  const options = argsToOptions(process.argv.slice(2));
  const point = await targetCoordinate(options);
  console.log(`Target: ${options.address}`);

  const [countyGeometry, streetContext] = await Promise.all([
    getLosAngelesSiteGeometry(point),
    getNearbyStreetContext(point).catch((error) => {
      console.warn(`Street context unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { roads: [], sidewalks: [] };
    }),
  ]);

  const geometry = {
    ...countyGeometry,
    roads: streetContext.roads,
    sidewalks: streetContext.sidewalks,
    provenance: [
      ...countyGeometry.provenance,
      ...streetContext.roads.flatMap((road) => road.provenance ? [road.provenance] : []),
      ...streetContext.sidewalks.flatMap((sidewalk) => sidewalk.provenance ? [sidewalk.provenance] : []),
    ],
  };

  const primary = geometry.buildings.find((building) => building.id === geometry.primaryBuildingId) ?? geometry.buildings[0];
  console.log(`Parcel: ${geometry.parcel?.id ?? "not found"}`);
  console.log(`Buildings: ${geometry.buildings.length}`);
  console.log(`Primary building: ${primary?.id ?? "not found"}${primary?.heightM ? `, ${primary.heightM.toFixed(2)} m measured height` : ""}`);

  const imagery = await findKartaViewImages(point, {
    radiusM: options.radiusM,
    selectedLimit: options.imageLimit,
  }).catch((error) => {
    console.warn(`KartaView discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    return [] as StreetImageCandidate[];
  });
  console.log(`Selected street frames: ${imagery.length}`);
  imagery.forEach((image, index) => console.log(`  ${index + 1}. ${image.id} score=${(image.score ?? 0).toFixed(3)} distance=${(image.distanceToTargetM ?? 0).toFixed(1)}m`));

  const observations: VisualObservation[] = [];
  const rejected: Array<{ imageId: string; error: string }> = [];
  const workDir = join(tmpdir(), `officeadmin-site-twin-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  try {
    if (!options.noVision) {
      for (const image of imagery) {
        try {
          const { bytes } = await downloadImage(image, workDir);
          console.log(`Analyzing ${image.id} with ${options.model}...`);
          const observation = await analyzeImageWithOllama(image.id, bytes.toString("base64"), {
            model: options.model,
            context: {
              targetBearingDeg: image.bearingToTargetDeg,
              expectedBuildingHeightM: primary?.heightM,
              targetDescription: `Target address is ${options.address}. The target is the property near the target coordinate, not merely any nearby house.`,
            },
          });
          observations.push(observation);
          console.log(`  visible=${observation.visible} confidence=${observation.confidence.toFixed(2)} roof=${observation.roof?.type ?? "unknown"}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rejected.push({ imageId: image.id, error: message });
          console.warn(`  rejected ${image.id}: ${message}`);
        }
      }
    } else {
      console.log("Vision disabled by --no-vision");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

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
      },
      primaryBuilding: primary,
      rankedImagery: imagery,
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
