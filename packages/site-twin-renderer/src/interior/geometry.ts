/*
 * geometry.ts -- renderer-free geometry maths for the interior scene, ported
 * from the E4 viewer's app/scene.js. Positions are flat arrays in the
 * canonical frame (metres, right-handed, +Z up): triangles are 9 numbers per
 * triangle, line segments 6 numbers per segment.
 */
import { ShapeUtils, Vector2 } from "three";
import type { Point3, Quaternion, Size3 } from "./canonical";

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const pt = (p: Point3): Vec3 => [p.x, p.y, p.z];

/** Rotate p by quaternion q. A missing quaternion or component is identity. */
export function quatRotate(q: Quaternion | undefined | null, p: Vec3): Vec3 {
  if (!q) return [p[0], p[1], p[2]];
  const x = q.x ?? 0;
  const y = q.y ?? 0;
  const z = q.z ?? 0;
  const w = q.w ?? 1;
  const ix = w * p[0] + y * p[2] - z * p[1];
  const iy = w * p[1] + z * p[0] - x * p[2];
  const iz = w * p[2] + x * p[1] - y * p[0];
  const iw = -x * p[0] - y * p[1] - z * p[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function boxCorners(center: Vec3, size: Size3, rotation?: Quaternion | null): Vec3[] {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const signs: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  return signs.map((s) => add(center, quatRotate(rotation, [s[0] * hx, s[1] * hy, s[2] * hz])));
}

const BOX_FACES = [
  [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
] as const;
const BOX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
] as const;

export function pushTri(out: number[], a: Vec3, b: Vec3, c: Vec3) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}
export function pushSeg(out: number[], a: Vec3, b: Vec3) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
}

export function hexaTriangles(corners: Vec3[], out: number[] = []) {
  for (const q of BOX_FACES) {
    pushTri(out, corners[q[0]]!, corners[q[1]]!, corners[q[2]]!);
    pushTri(out, corners[q[0]]!, corners[q[2]]!, corners[q[3]]!);
  }
  return out;
}
export function hexaLines(corners: Vec3[], out: number[] = []) {
  for (const e of BOX_EDGES) pushSeg(out, corners[e[0]]!, corners[e[1]]!);
  return out;
}

export function polylineLines(points: Vec3[], closed: boolean, out: number[] = []) {
  for (let i = 0; i + 1 < points.length; i += 1) pushSeg(out, points[i]!, points[i + 1]!);
  if (closed && points.length > 2) pushSeg(out, points[points.length - 1]!, points[0]!);
  return out;
}

export function isConvexXY(points: Vec3[]) {
  let sign = 0;
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const c = points[(i + 2) % n]!;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

function segmentsCross(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  const orient = (p: Vec3, q: Vec3, r: Vec3) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

/** True when the XY ring has no two non-adjacent edges that properly cross. */
export function isSimpleXY(points: Vec3[]) {
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/**
 * Extrude an XY footprint between two elevations as triangles. A convex ring is
 * fanned exactly as E4 did. A simple (non-self-intersecting) non-convex ring is
 * triangulated with earcut: the interior of a simple polygon is uniquely
 * defined, so this is exact rather than a guess. A self-intersecting ring has no
 * single interior and returns null so the caller draws an outline instead.
 */
export function extrudeFootprint(points: Vec3[], zBottom: number, zTop: number, out: number[] = []) {
  const n = points.length;
  if (n < 3) return null;
  const bot = points.map((p): Vec3 => [p[0], p[1], zBottom]);
  const top = points.map((p): Vec3 => [p[0], p[1], zTop]);
  if (isConvexXY(points)) {
    for (let i = 1; i + 1 < n; i += 1) {
      pushTri(out, top[0]!, top[i]!, top[i + 1]!);
      pushTri(out, bot[0]!, bot[i + 1]!, bot[i]!);
    }
  } else if (isSimpleXY(points)) {
    const faces = ShapeUtils.triangulateShape(points.map((p) => new Vector2(p[0], p[1])), []);
    for (const [a, b, c] of faces) {
      pushTri(out, top[a]!, top[b]!, top[c]!);
      pushTri(out, bot[a]!, bot[c]!, bot[b]!);
    }
  } else {
    return null;
  }
  for (let j = 0; j < n; j += 1) {
    const k = (j + 1) % n;
    pushTri(out, bot[j]!, bot[k]!, top[k]!);
    pushTri(out, bot[j]!, top[k]!, top[j]!);
  }
  return out;
}

/** One box per centerline segment: half-thickness either side, extruded up by height. */
export function wallSegments(points: Vec3[], thickness: number, height: number, asLines: boolean, out: number[] = []) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    let t = normalize([b[0] - a[0], b[1] - a[1], 0]);
    if (length(t) < 1e-9) t = [1, 0, 0];
    const half = scale([-t[1], t[0], 0], thickness / 2);
    const corners: Vec3[] = [
      sub(a, half), sub(b, half), add(b, half), add(a, half),
      add(sub(a, half), [0, 0, height]), add(sub(b, half), [0, 0, height]),
      add(add(b, half), [0, 0, height]), add(add(a, half), [0, 0, height]),
    ];
    if (asLines) hexaLines(corners, out);
    else hexaTriangles(corners, out);
  }
  return out;
}

/** Deterministic frame perpendicular to a tangent. */
export function perpFrame(tangent: Vec3): [Vec3, Vec3] {
  let t = normalize(tangent);
  if (length(t) < 1e-9) t = [1, 0, 0];
  const ref: Vec3 = Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = normalize(cross(ref, t));
  if (length(u) < 1e-9) u = normalize(cross([0, 1, 0], t));
  const w = normalize(cross(t, u));
  return [u, w];
}

function tangentsAlong(points: Vec3[]) {
  return points.map((point, i) => {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let t = sub(next, prev);
    if (length(t) < 1e-9) t = sub(points[Math.min(points.length - 1, i + 1)]!, point);
    return normalize(t);
  });
}

/** Wireframe tube along a polyline: `sides` rails plus a hoop at every vertex. Never filled. */
export function tubeWire(points: Vec3[], radius: number, sides: number, out: number[] = []) {
  const tans = tangentsAlong(points);
  const rings = points.map((point, i) => {
    const [u, w] = perpFrame(tans[i]!);
    return Array.from({ length: sides }, (_, s) => {
      const angle = (2 * Math.PI * s) / sides;
      return add(point, add(scale(u, Math.cos(angle) * radius), scale(w, Math.sin(angle) * radius)));
    });
  });
  rings.forEach((ring, r) => {
    for (let k = 0; k < sides; k += 1) {
      pushSeg(out, ring[k]!, ring[(k + 1) % sides]!);
      if (r + 1 < rings.length) pushSeg(out, ring[k]!, rings[r + 1]![k]!);
    }
  });
  return out;
}

export function offsetPolyline(points: Vec3[], radius: number, angle: number) {
  const tans = tangentsAlong(points);
  return points.map((point, i) => {
    const [u, w] = perpFrame(tans[i]!);
    return add(point, add(scale(u, Math.cos(angle) * radius), scale(w, Math.sin(angle) * radius)));
  });
}

/** "Something is here but the model gives it no shape": an axis cross in a small wire box. */
export function placeholderMarker(center: Vec3, size: number, out: number[] = []) {
  const h = size / 2;
  pushSeg(out, [center[0] - h, center[1], center[2]], [center[0] + h, center[1], center[2]]);
  pushSeg(out, [center[0], center[1] - h, center[2]], [center[0], center[1] + h, center[2]]);
  pushSeg(out, [center[0], center[1], center[2] - h], [center[0], center[1], center[2] + h]);
  hexaLines(boxCorners(center, { x: size * 0.62, y: size * 0.62, z: size * 0.62 }, null), out);
  return out;
}

export interface Bounds3 { min: Vec3; max: Vec3 }

export function boundsOfPositions(positions: number[], into?: Bounds3): Bounds3 {
  const bounds = into ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const value = positions[i + a]!;
      if (value < bounds.min[a]!) bounds.min[a] = value;
      if (value > bounds.max[a]!) bounds.max[a] = value;
    }
  }
  return bounds;
}

export function polylineLength(points: Vec3[]) {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) total += length(sub(points[i + 1]!, points[i]!));
  return total;
}
