import type { Coordinate, Position, TerrainSample } from "@officeadmin-geo/site-twin-core";

const EPQS = "https://epqs.nationalmap.gov/v1/json";

interface EpqsResponse {
  value?: string | number;
  rasterId?: number;
  resolution?: number;
}

export async function getElevation(point: Coordinate): Promise<TerrainSample> {
  const url = new URL(EPQS);
  url.searchParams.set("x", String(point.longitude));
  url.searchParams.set("y", String(point.latitude));
  url.searchParams.set("units", "Meters");
  url.searchParams.set("wkid", "4326");
  url.searchParams.set("includeDate", "false");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`USGS EPQS elevation query failed with ${response.status}`);
  const payload = (await response.json()) as EpqsResponse;
  const elevationM = Number(payload.value);
  if (!Number.isFinite(elevationM)) throw new Error("USGS EPQS returned an invalid elevation value");

  return {
    coordinate: point,
    elevationM,
    provenance: {
      provider: "usgs-epqs",
      sourceUrl: EPQS,
      details: {
        rasterId: payload.rasterId,
        resolutionM: payload.resolution,
      },
    },
  };
}

function polygonBounds(polygon: Position[]) {
  const longitudes = polygon.map(([longitude]) => longitude);
  const latitudes = polygon.map(([, latitude]) => latitude);
  return {
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
  };
}

function expandBounds(bounds: ReturnType<typeof polygonBounds>, marginDegrees: number) {
  return {
    minLongitude: bounds.minLongitude - marginDegrees,
    maxLongitude: bounds.maxLongitude + marginDegrees,
    minLatitude: bounds.minLatitude - marginDegrees,
    maxLatitude: bounds.maxLatitude + marginDegrees,
  };
}

export async function sampleTerrainGrid(
  polygon: Position[],
  size = 4,
  marginM = 18,
): Promise<TerrainSample[]> {
  if (polygon.length < 3) return [];
  const centerLatitude = polygon.reduce((sum, [, latitude]) => sum + latitude, 0) / polygon.length;
  const latitudeMargin = marginM / 111_320;
  const longitudeMargin = marginM / (111_320 * Math.cos((centerLatitude * Math.PI) / 180));
  const base = polygonBounds(polygon);
  const bounds = expandBounds(base, Math.max(latitudeMargin, longitudeMargin));
  const points: Coordinate[] = [];
  const steps = Math.max(2, Math.min(8, Math.round(size)));

  for (let row = 0; row < steps; row += 1) {
    const tLat = row / (steps - 1);
    const latitude = bounds.minLatitude + (bounds.maxLatitude - bounds.minLatitude) * tLat;
    for (let column = 0; column < steps; column += 1) {
      const tLon = column / (steps - 1);
      const longitude = bounds.minLongitude + (bounds.maxLongitude - bounds.minLongitude) * tLon;
      points.push({ latitude, longitude });
    }
  }

  return Promise.all(points.map(getElevation));
}
