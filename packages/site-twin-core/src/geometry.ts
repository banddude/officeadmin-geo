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
