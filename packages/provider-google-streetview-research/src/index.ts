import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Coordinate, StreetImageCandidate } from "@officeadmin-geo/site-twin-core";
import { rankStreetImages, selectDistinctStreetImages } from "@officeadmin-geo/site-twin-core";

interface RawPanorama {
  panoId: string;
  latitude: number;
  longitude: number;
  panoramaHeadingDeg: number;
  pitchDeg?: number;
  rollDeg?: number;
  capturedAt?: string;
  elevationM?: number;
}

export interface GoogleStreetViewResearchOptions {
  radiusM?: number;
  selectedLimit?: number;
  candidateLimit?: number;
  pythonExecutable?: string;
  zoom?: number;
  fovDeg?: number;
}

const SEARCH_URL =
  "https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch";

function makeSearchUrl(target: Coordinate) {
  const pb =
    `!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${target.latitude}!4d${target.longitude}` +
    "!2d50!3m10!2m2!1sen!2sGB!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10" +
    "!1e1!1e2!1e3!1e4!1e8!1e6!5m1!1e2!6m1!1e2";
  const url = new URL(SEARCH_URL);
  url.searchParams.set("pb", pb);
  url.searchParams.set("callback", "callbackfunc");
  return url;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(value: unknown, ...indexes: number[]): unknown {
  let current = value;
  for (const index of indexes) {
    if (!Array.isArray(current)) return undefined;
    current = current[index];
  }
  return current;
}

export function parseGoogleStreetViewSearch(text: string): RawPanorama[] {
  const match = text.match(/callbackfunc\(\s*(.*)\s*\)$/s);
  if (!match?.[1]) return [];
  const data = JSON.parse(match[1]) as unknown;
  if (JSON.stringify(data) === JSON.stringify([[5, "generic", "Search returned no images."]])) return [];

  const subset = at(data, 1, 5, 0);
  if (!Array.isArray(subset)) return [];
  const rawPanos = asArray(at(subset, 3, 0)).slice().reverse();
  const rawDates = asArray(at(subset, 8)).slice().reverse();
  const dates = rawDates.map((entry) => {
    const year = Number(at(entry, 1, 0));
    const month = Number(at(entry, 1, 1));
    return Number.isFinite(year) && Number.isFinite(month)
      ? `${year}-${String(month).padStart(2, "0")}-01 00:00:00`
      : undefined;
  });

  return rawPanos.flatMap((pano, index) => {
    const panoId = at(pano, 0, 1);
    const latitude = Number(at(pano, 2, 0, 2));
    const longitude = Number(at(pano, 2, 0, 3));
    const panoramaHeadingDeg = Number(at(pano, 2, 2, 0));
    if (typeof panoId !== "string" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      panoId,
      latitude,
      longitude,
      panoramaHeadingDeg: Number.isFinite(panoramaHeadingDeg) ? panoramaHeadingDeg : 0,
      pitchDeg: Number.isFinite(Number(at(pano, 2, 2, 1))) ? Number(at(pano, 2, 2, 1)) : undefined,
      rollDeg: Number.isFinite(Number(at(pano, 2, 2, 2))) ? Number(at(pano, 2, 2, 2)) : undefined,
      capturedAt: dates[index],
      elevationM: Number.isFinite(Number(at(pano, 3, 0))) ? Number(at(pano, 3, 0)) : undefined,
    }];
  });
}

export function panoramaNormalizedX(viewHeadingDeg: number, panoramaHeadingDeg: number) {
  return (((viewHeadingDeg - panoramaHeadingDeg + 180) % 360) + 360) % 360 / 360;
}

export async function findGoogleStreetViewImages(
  target: Coordinate,
  options: GoogleStreetViewResearchOptions = {},
): Promise<StreetImageCandidate[]> {
  const radiusM = options.radiusM ?? 500;
  const selectedLimit = options.selectedLimit ?? 4;
  const candidateLimit = options.candidateLimit ?? 40;
  const response = await fetch(makeSearchUrl(target), {
    headers: { Accept: "text/javascript,*/*", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`Google Street View research search failed with ${response.status}`);
  const panos = parseGoogleStreetViewSearch(await response.text()).slice(0, candidateLimit);
  const candidates: StreetImageCandidate[] = panos.map((pano) => ({
    id: pano.panoId,
    provider: "google-streetview-research",
    latitude: pano.latitude,
    longitude: pano.longitude,
    capturedAt: pano.capturedAt,
    imageUrl: `google-streetview-research://${encodeURIComponent(pano.panoId)}`,
    provenance: {
      provider: "google-streetview-research",
      featureId: pano.panoId,
      capturedAt: pano.capturedAt,
      details: {
        panoramaHeadingDeg: pano.panoramaHeadingDeg,
        pitchDeg: pano.pitchDeg,
        rollDeg: pano.rollDeg,
        elevationM: pano.elevationM,
      },
    },
  }));

  // Google panoramas are 360 degree sources. Rank by distance and recency first,
  // then define the generated view heading as the bearing from panorama to target.
  const firstPass = rankStreetImages(candidates, target, radiusM);
  const targetFacing = firstPass.map((candidate) => ({
    ...candidate,
    headingDeg: candidate.bearingToTargetDeg,
  }));
  return selectDistinctStreetImages(rankStreetImages(targetFacing, target, radiusM), selectedLimit);
}

function detailNumber(image: StreetImageCandidate, key: string) {
  const raw = image.provenance?.details?.[key];
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function downloadGoogleStreetViewFrame(
  image: StreetImageCandidate,
  options: GoogleStreetViewResearchOptions = {},
): Promise<Buffer> {
  if (image.provider !== "google-streetview-research") {
    throw new Error(`Cannot render provider ${image.provider} as Google Street View`);
  }
  const panoHeading = detailNumber(image, "panoramaHeadingDeg") ?? 0;
  const viewHeading = image.bearingToTargetDeg ?? image.headingDeg;
  if (viewHeading == null) throw new Error("Google Street View candidate is missing a target-facing heading");

  const script = fileURLToPath(new URL("./render-frame.py", import.meta.url));
  const python = options.pythonExecutable ?? process.env.SITE_TWIN_PYTHON ?? "python3";
  const args = [
    script,
    "--pano-id", image.id,
    "--pano-heading", String(panoHeading),
    "--view-heading", String(viewHeading),
    "--zoom", String(options.zoom ?? 3),
    "--fov", String(options.fovDeg ?? 100),
  ];

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(python, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Google Street View frame renderer failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      const output = Buffer.concat(stdout);
      if (output.length < 1_000) {
        reject(new Error(`Google Street View frame renderer returned only ${output.length} bytes`));
        return;
      }
      resolve(output);
    });
  });
}
