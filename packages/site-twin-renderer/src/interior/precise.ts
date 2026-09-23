/*
 * precise.ts -- the numbers behind PRECISE mode: mounting heights, route
 * segment lengths and elevations, read straight from canonical coordinates.
 *
 * Nothing here is stylised or rounded before display: every value is computed
 * from canonical fields, and the reference each one is measured from is named
 * alongside it ("above the floor of <level>, found through <reference chain>").
 * A height with no level to measure from is reported in the model frame and
 * says so, rather than borrowing a floor it does not have.
 */
import type { ElectricalDevice, ElectricalEquipment, Route } from "./canonical";
import { pt, sub, length, type Vec3 } from "./geometry";
import type { Drawable, InteriorScene } from "./interiorScene";

export const METRES_PER_FOOT = 0.3048;

/** Feet and inches to the nearest 1/8", e.g. 0.4572 -> 1'-6". */
export function feetInches(metres: number) {
  const sign = metres < 0 ? "-" : "";
  const eighths = Math.round((Math.abs(metres) / 0.0254) * 8);
  const feet = Math.floor(eighths / 96);
  const remainder = eighths - feet * 96;
  const inches = Math.floor(remainder / 8);
  const frac = remainder - inches * 8;
  const fraction = frac === 0 ? "" : ` ${reduce(frac, 8)}`;
  return `${sign}${feet}'-${inches}${fraction}"`;
}

function reduce(n: number, d: number) {
  const g = gcd(n, d);
  return `${n / g}/${d / g}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formatMetres(metres: number, digits = 3) {
  return `${metres.toFixed(digits)} m`;
}

export function formatDimension(metres: number) {
  return `${formatMetres(metres)} (${feetInches(metres)})`;
}

export interface MountingHeight {
  levelId: string | null;
  levelName: string | null;
  levelBasis: string;
  /** Canonical pose z. */
  zModel: number;
  /** Heights above the level's elevation; null when no level is reachable. */
  centerAff: number | null;
  bottomAff: number | null;
  topAff: number | null;
  /** Bottom/top come from the canonical size; null when the model gives none. */
  hasSize: boolean;
}

/**
 * Mounting height of a device or equipment: pose z minus the elevation of the
 * level its canonical references reach. Bottom/top use the drawn bounds, which
 * for a sized element are exactly the canonical pose + size box.
 */
export function mountingHeight(drawable: Drawable, scene: InteriorScene): MountingHeight | null {
  if (drawable.entityKind !== "electrical_device" && drawable.entityKind !== "electrical_equipment") return null;
  const entity = drawable.entity as unknown as ElectricalDevice | ElectricalEquipment;
  const zModel = entity.pose.position.z;
  const level = drawable.levelId ? scene.levels.find((l) => l.id === drawable.levelId) ?? null : null;
  const hasSize = drawable.basis === "canonical-solid";
  const base = level ? level.elevation_m : null;
  return {
    levelId: level?.id ?? null,
    levelName: level?.name ?? null,
    levelBasis: drawable.levelBasis,
    zModel,
    centerAff: base === null ? null : zModel - base,
    bottomAff: base === null || !hasSize ? null : drawable.bounds.min[2] - base,
    topAff: base === null || !hasSize ? null : drawable.bounds.max[2] - base,
    hasSize,
  };
}

export interface RouteSegment { index: number; from: Vec3; to: Vec3; lengthM: number; midpoint: Vec3; vertical: boolean }

export interface RouteDimensions {
  totalM: number;
  segments: RouteSegment[];
  /** Each centerline vertex with its height above the route's level (if any). */
  vertices: Array<{ point: Vec3; aff: number | null }>;
  levelElevation: number | null;
}

export function routeDimensions(drawable: Drawable, scene: InteriorScene): RouteDimensions | null {
  if (drawable.entityKind !== "route") return null;
  const route = drawable.entity as unknown as Route;
  const points = route.centerline.points.map(pt);
  const level = drawable.levelId ? scene.levels.find((l) => l.id === drawable.levelId) ?? null : null;
  const base = level ? level.elevation_m : null;
  const segments: RouteSegment[] = [];
  let totalM = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const d = sub(to, from);
    const lengthM = length(d);
    totalM += lengthM;
    segments.push({
      index: i,
      from,
      to,
      lengthM,
      midpoint: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      vertical: Math.hypot(d[0], d[1]) < 1e-9,
    });
  }
  return { totalM, segments, vertices: points.map((point) => ({ point, aff: base === null ? null : point[2] - base })), levelElevation: base };
}
