import type { Coordinate, GeocodeResult, LineFeature, Position } from "@officeadmin-geo/site-twin-core";

const USER_AGENT = "officeadmin-geo-site-twin-research/0.1";

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Nominatim geocoding failed with ${response.status}`);
  const results = (await response.json()) as Array<{ place_id: number; lat: string; lon: string; display_name: string }>;
  const first = results[0];
  if (!first) throw new Error(`No geocoding result for ${address}`);
  return {
    address: first.display_name,
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    provider: "nominatim",
    providerId: String(first.place_id),
  };
}

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: Array<OverpassWay | { type: string; id: number }>;
}

function normalizeWay(way: OverpassWay): LineFeature | undefined {
  const points: Position[] = (way.geometry ?? []).map((point) => [point.lon, point.lat]);
  if (points.length < 2) return undefined;
  const highway = way.tags?.highway;
  return {
    id: `osm-way-${way.id}`,
    points,
    kind: highway,
    widthM: way.tags?.width ? Number.parseFloat(way.tags.width) : undefined,
    provenance: {
      provider: "openstreetmap",
      featureId: String(way.id),
      details: { highway: highway ?? "unknown", name: way.tags?.name },
    },
  };
}

export async function getNearbyStreetContext(point: Coordinate, radiusM = 120): Promise<{ roads: LineFeature[]; sidewalks: LineFeature[] }> {
  const query = `[out:json][timeout:20];way(around:${radiusM},${point.latitude},${point.longitude})["highway"];out tags geom;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass street query failed with ${response.status}`);
  const payload = (await response.json()) as OverpassResponse;
  const lines = payload.elements
    .filter((element): element is OverpassWay => element.type === "way")
    .map(normalizeWay)
    .filter((line): line is LineFeature => Boolean(line));

  const sidewalkKinds = new Set(["footway", "path", "pedestrian", "steps"]);
  return {
    roads: lines.filter((line) => !sidewalkKinds.has(line.kind ?? "")),
    sidewalks: lines.filter((line) => sidewalkKinds.has(line.kind ?? "")),
  };
}
