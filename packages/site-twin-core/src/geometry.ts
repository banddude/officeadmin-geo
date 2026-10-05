import type { Coordinate, Position, StreetImageCandidate } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function degrees(value: number) {
  return (value * 180) / Math.PI;
}

export function haversineMeters(a: Coordinate, b: Coordinate) {
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(from: Coordinate, to: Coordinate) {
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function angularDifferenceDegrees(a: number, b: number) {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export function localMeters(position: Position, origin: Coordinate): [number, number] {
  const [longitude, latitude] = position;
  const lat0 = radians(origin.latitude);
  const x = radians(longitude - origin.longitude) * EARTH_RADIUS_M * Math.cos(lat0);
  const z = -radians(latitude - origin.latitude) * EARTH_RADIUS_M;
  return [x, z];
}

export function polygonCentroid(polygon: Position[]): Coordinate {
  if (polygon.length === 0) {
    throw new Error("Cannot compute centroid of an empty polygon");
  }
  const distinct = polygon.length > 1 && polygon[0]?.[0] === polygon.at(-1)?.[0] && polygon[0]?.[1] === polygon.at(-1)?.[1]
    ? polygon.slice(0, -1)
    : polygon;
  const sum = distinct.reduce(
    (acc, [longitude, latitude]) => ({ longitude: acc.longitude + longitude, latitude: acc.latitude + latitude }),
    { longitude: 0, latitude: 0 },
  );
  return {
    longitude: sum.longitude / distinct.length,
    latitude: sum.latitude / distinct.length,
  };
}

export function rankStreetImages(images: StreetImageCandidate[], target: Coordinate, radiusM = 500) {
  return images
    .map((image) => {
      const distanceToTargetM = haversineMeters(image, target);
      const bearingToTargetDeg = bearingDegrees(image, target);
      const scoreReasons: string[] = [];
      const distanceScore = Math.max(0, 1 - distanceToTargetM / Math.max(radiusM, 1));
      scoreReasons.push(`distance:${distanceToTargetM.toFixed(1)}m`);

      let headingScore = 0.5;
      let headingErrorDeg: number | undefined;
      if (typeof image.headingDeg === "number") {
        headingErrorDeg = angularDifferenceDegrees(image.headingDeg, bearingToTargetDeg);
        headingScore = Math.max(0, 1 - headingErrorDeg / 110);
        scoreReasons.push(`heading-error:${headingErrorDeg.toFixed(1)}deg`);
      } else {
        scoreReasons.push("heading:unknown");
      }

      let recencyScore = 0.4;
      if (image.capturedAt) {
        const timestamp = Date.parse(image.capturedAt.replace(" ", "T") + "Z");
        if (Number.isFinite(timestamp)) {
          const ageYears = Math.max(0, (Date.now() - timestamp) / (365.25 * 24 * 60 * 60 * 1000));
          recencyScore = Math.max(0.15, 1 - ageYears / 12);
          scoreReasons.push(`age:${ageYears.toFixed(1)}y`);
        }
      }

      const score = distanceScore * 0.45 + headingScore * 0.45 + recencyScore * 0.1;
      return {
        ...image,
        distanceToTargetM,
        bearingToTargetDeg,
        headingErrorDeg,
        score,
        scoreReasons,
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function selectDistinctStreetImages(images: StreetImageCandidate[], count: number, minSpacingM = 12) {
  const selected: StreetImageCandidate[] = [];
  for (const image of images) {
    if (selected.length >= count) break;
    const tooClose = selected.some((other) => haversineMeters(image, other) < minSpacingM);
    if (!tooClose) selected.push(image);
  }
  return selected;
}

export function extentPolygon(polygons: Position[][]): Position[] {
  const points = polygons.flat().filter((point): point is Position =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (!points.length) return [];
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  return [
    [minLongitude, minLatitude],
    [maxLongitude, minLatitude],
    [maxLongitude, maxLatitude],
    [minLongitude, maxLatitude],
    [minLongitude, minLatitude],
  ];
}

export function renderedBuildingHeightM(building: {
  heightM?: number;
  groundElevationM?: number;
  roofElevationM?: number;
}, fallbackHeightM = 6.2) {
  if (
    typeof building.groundElevationM === "number" && Number.isFinite(building.groundElevationM) &&
    typeof building.roofElevationM === "number" && Number.isFinite(building.roofElevationM) &&
    building.roofElevationM > building.groundElevationM
  ) {
    const derived = building.roofElevationM - building.groundElevationM;
    if (derived >= 1.5 && derived <= 30) return derived;
  }
  if (typeof building.heightM === "number" && Number.isFinite(building.heightM) && building.heightM >= 1.5 && building.heightM <= 30) {
    return building.heightM;
  }
  return fallbackHeightM;
}

export function nearestFacadeEdgeIndex(
  polygon: Position[],
  camera: Coordinate,
  minEdgeLengthM = 1.5,
) {
  if (polygon.length < 2) return undefined;
  const center = polygonCentroid(polygon);
  const cameraLocal = localMeters([camera.longitude, camera.latitude], center);
  const closed = polygon.length > 2 && polygon[0]?.[0] === polygon.at(-1)?.[0] && polygon[0]?.[1] === polygon.at(-1)?.[1]
    ? polygon
    : [...polygon, polygon[0]!];

  let winner: { index: number; score: number } | undefined;
  for (let index = 0; index < closed.length - 1; index += 1) {
    const a = localMeters(closed[index]!, center);
    const b = localMeters(closed[index + 1]!, center);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < minEdgeLengthM) continue;
    const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = Math.hypot(cameraLocal[0] - midpoint[0], cameraLocal[1] - midpoint[1]);
    // Prefer the closest substantial facade run. A modest length bonus avoids
    // selecting tiny architectural jogs in detailed County footprints.
    const score = distance - Math.min(8, length) * 0.65;
    if (!winner || score < winner.score) winner = { index, score };
  }
  return winner?.index;
}
