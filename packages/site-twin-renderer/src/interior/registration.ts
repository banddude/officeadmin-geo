/*
 * registration.ts -- placing the interior's canonical frame on the site.
 *
 * The interior BuildingModel lives in its own local frame (metres, +Z up, XY
 * plan). The exterior is placed by GIS in local metres around the site model's
 * `center`. Nothing in either model says how one sits inside the other, so a
 * placement is a CLAIM, and this viewer treats it like every other claim:
 *
 *   - It is an EXPLICIT input -- a registration document -- never a default,
 *     never "put it at the origin", never an automatic fit to the footprint.
 *     With no registration the interior is not drawn on the site at all.
 *   - It carries its own canonical-shaped `provenance`, classified by the same
 *     policy as every element (provenance.ts): a placement a person chose is
 *     `user` and is drawn and labelled as such; a tool-fitted one is
 *     `inferred`; one nobody vouches for fails closed to `inferred`.
 *   - It names the interior it was made for (model_id + frame_id) and is
 *     refused for any other, so a registration cannot silently move to a
 *     different model.
 *   - The model is never edited to hold it. The canonical CoordinateSystem has
 *     optional crs/origin_in_crs/true_north_radians, but no provenance, so a
 *     placement stored there could not say who chose it.
 *
 * Parameters (all in canonical units -- metres, radians):
 *   anchor        WGS84 latitude/longitude where the interior's (0,0) lands
 *   elevation_m   absolute elevation of the interior's z = 0, in the SAME
 *                 vertical datum as the site model's terrain samples
 *   rotation_rad  counter-clockwise, seen from above, from geographic east to
 *                 the interior's +X axis
 *
 * Site Twin's world frame (see SiteTwinScene.tsx / site-twin-core localMeters):
 *   X = east, Y = up, Z = south (i.e. -north), metres, origin at model.center,
 *   and Y = elevation - (lowest terrain sample elevation, or 0 without terrain).
 */
import type { Position, SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { localMeters } from "@officeadmin-geo/site-twin-core";
import type { Provenance } from "./canonical";
import { classifyEntity, type EntityVerdict } from "./provenance";

export const REGISTRATION_VERSION = "1" as const;

export interface InteriorRegistration {
  registration_version: typeof REGISTRATION_VERSION;
  id: string;
  name?: string | null;
  /** The interior this placement was made for. Refused for any other. */
  interior: { model_id: string; frame_id: string };
  anchor: { latitude: number; longitude: number };
  elevation_m: number;
  rotation_rad: number;
  provenance: Provenance[];
  confidence?: number;
  notes?: string | null;
  attributes?: Record<string, unknown>;
}

export type RegistrationParse =
  | { ok: true; registration: InteriorRegistration; verdict: EntityVerdict }
  | { ok: false; errors: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const KEYS = new Set(["registration_version", "id", "name", "interior", "anchor", "elevation_m", "rotation_rad", "provenance", "confidence", "notes", "attributes"]);

/**
 * Validate a registration document against the interior it claims to place.
 * `interior` is the parsed model's identity; pass it whenever one is loaded.
 */
export function parseRegistration(input: unknown, interior?: { model_id: string; frame_id: string }): RegistrationParse {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ["$: a registration must be a JSON object"] };
  for (const key of Object.keys(input)) if (!KEYS.has(key)) errors.push(`$.${key}: is not a registration field`);
  if (input.registration_version !== REGISTRATION_VERSION) errors.push(`$.registration_version: must be "${REGISTRATION_VERSION}"`);
  if (typeof input.id !== "string" || !input.id) errors.push("$.id: must be a non-empty string");
  const target = input.interior;
  if (!isObject(target) || typeof target.model_id !== "string" || typeof target.frame_id !== "string") {
    errors.push("$.interior: must name the interior's model_id and frame_id");
  } else if (interior && (target.model_id !== interior.model_id || target.frame_id !== interior.frame_id)) {
    errors.push(
      `$.interior: this registration was made for ${target.model_id} (frame ${target.frame_id}), ` +
        `not for ${interior.model_id} (frame ${interior.frame_id}); it is refused rather than applied to the wrong model`,
    );
  }
  const anchor = input.anchor;
  if (!isObject(anchor) || !finite(anchor.latitude) || !finite(anchor.longitude)) {
    errors.push("$.anchor: must have finite latitude and longitude");
  } else if (Math.abs(anchor.latitude) > 90 || Math.abs(anchor.longitude) > 180) {
    errors.push("$.anchor: latitude/longitude out of range");
  }
  if (!finite(input.elevation_m)) errors.push("$.elevation_m: must be a finite number (metres)");
  if (!finite(input.rotation_rad)) errors.push("$.rotation_rad: must be a finite number (radians)");
  if (input.confidence !== undefined && !(finite(input.confidence) && input.confidence >= 0 && input.confidence <= 1)) {
    errors.push("$.confidence: must be between 0 and 1");
  }
  if (!Array.isArray(input.provenance)) {
    errors.push("$.provenance: must be an array of Provenance records (an empty array is allowed and classifies as inferred)");
  } else {
    input.provenance.forEach((record, i) => {
      if (!isObject(record) || typeof record.source_kind !== "string" || !record.source_kind || typeof record.source_id !== "string" || !record.source_id) {
        errors.push(`$.provenance[${i}]: needs non-empty source_kind and source_id`);
      } else if (record.derivation !== undefined && record.derivation !== null && !["observed", "user", "inferred"].includes(record.derivation as string)) {
        errors.push(`$.provenance[${i}].derivation: must be observed, user, inferred or null`);
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  const registration = input as unknown as InteriorRegistration;
  return { ok: true, registration, verdict: classifyEntity("registration", registration) };
}

/** The site's world frame, as SiteTwinScene draws it. */
export interface SiteFrame {
  center: { latitude: number; longitude: number };
  /** Absolute elevation drawn at world Y = 0. */
  verticalDatumM: number;
}

/**
 * Must match SiteTwinScene.tsx `terrainBaseElevation`: the lowest terrain
 * sample, or 0 when the site model has no terrain. Duplicated (not imported)
 * because that helper is private to the exterior renderer.
 */
export function siteFrameOf(site: Pick<SemanticSiteModel, "center" | "geometry">): SiteFrame {
  const terrain = site.geometry.terrain;
  return {
    center: { latitude: site.center.latitude, longitude: site.center.longitude },
    verticalDatumM: terrain.length ? Math.min(...terrain.map((sample) => sample.elevationM)) : 0,
  };
}

export type Vec3 = [number, number, number];

export interface RegistrationTransform {
  /** Column-major 4x4 (THREE.Matrix4.fromArray order), canonical -> site world. */
  matrix: number[];
  /** World position of the interior origin. */
  originWorld: Vec3;
  /** Anchor offset from the site center, metres east / north. */
  anchorEastM: number;
  anchorNorthM: number;
  rotation_rad: number;
}

export function registrationTransform(registration: InteriorRegistration, frame: SiteFrame): RegistrationTransform {
  const [anchorX, anchorZ] = localMeters(
    [registration.anchor.longitude, registration.anchor.latitude] as Position,
    frame.center,
  );
  const theta = registration.rotation_rad;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const y0 = registration.elevation_m - frame.verticalDatumM;
  // Columns are the images of canonical +X, +Y, +Z, then the translation.
  //   +X -> east cos + north sin  -> world ( c, 0, -s)
  //   +Y -> east -sin + north cos -> world (-s, 0, -c)
  //   +Z -> up                    -> world ( 0, 1,  0)
  const matrix = [
    c, 0, -s, 0,
    -s, 0, -c, 0,
    0, 1, 0, 0,
    anchorX, y0, anchorZ, 1,
  ];
  return { matrix, originWorld: [anchorX, y0, anchorZ], anchorEastM: anchorX, anchorNorthM: -anchorZ, rotation_rad: theta };
}

/** Apply a registration transform to one canonical point. */
export function canonicalToWorld(transform: RegistrationTransform, p: Vec3): Vec3 {
  const m = transform.matrix;
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/** Determinant of the linear part; +1 for a proper (non-mirroring) placement. */
export function linearDeterminant(matrix: number[]) {
  const [a, b, c, , d, e, f, , g, h, i] = matrix as [number, number, number, number, number, number, number, number, number, number, number];
  return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
}

/** World direction (unit, horizontal) of a canonical plan direction. */
export function canonicalDirectionToWorld(transform: RegistrationTransform, d: Vec3): Vec3 {
  const m = transform.matrix;
  return [
    m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
    m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
    m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
  ];
}

export interface FootprintCheck {
  checkedPoints: number;
  outsidePoints: number;
  /** Largest plan distance, in metres, by which a checked point lies outside the footprint. */
  maxOutsideM: number;
}

/**
 * How well does the registered interior sit inside the site's building
 * footprint? A DIAGNOSTIC for the person who chose the registration; it never
 * moves anything. Points are canonical plan points (wall ends, slab corners).
 */
export function footprintContainment(
  transform: RegistrationTransform,
  footprint: Position[],
  frame: SiteFrame,
  canonicalPoints: Vec3[],
): FootprintCheck {
  const ring = footprint.map((p) => localMeters(p, frame.center));
  if (ring.length > 1) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  let outsidePoints = 0;
  let maxOutsideM = 0;
  for (const p of canonicalPoints) {
    const w = canonicalToWorld(transform, p);
    const x = w[0];
    const z = w[2];
    if (pointInRing(ring, x, z)) continue;
    outsidePoints += 1;
    maxOutsideM = Math.max(maxOutsideM, distanceToRing(ring, x, z));
  }
  return { checkedPoints: canonicalPoints.length, outsidePoints, maxOutsideM };
}

function pointInRing(ring: Array<[number, number]>, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToRing(ring: Array<[number, number]>, x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** Inverse of localMeters, for authoring a registration from site-local metres. */
export function latLonFromLocal(frame: SiteFrame, eastM: number, northM: number) {
  const EARTH_RADIUS_M = 6_371_008.8; // must match site-twin-core geometry.ts
  const lat0 = (frame.center.latitude * Math.PI) / 180;
  return {
    latitude: frame.center.latitude + (northM / EARTH_RADIUS_M) * (180 / Math.PI),
    longitude: frame.center.longitude + (eastM / (EARTH_RADIUS_M * Math.cos(lat0))) * (180 / Math.PI),
  };
}
