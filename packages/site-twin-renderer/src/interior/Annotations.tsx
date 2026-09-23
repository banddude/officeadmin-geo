/*
 * Annotations.tsx -- everything drawn that is NOT a model element: labels,
 * dimensions, the registration marker, the GIS footprint, the precise grid and
 * the selection cage. None of it is pickable, and none of it uses a provenance
 * colour except the registration marker, which shows the registration's own
 * class (a placement a person chose is drawn as `user`).
 */
import { useMemo, type CSSProperties } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { Position } from "@officeadmin-geo/site-twin-core";
import { localMeters } from "@officeadmin-geo/site-twin-core";
import type { Drawable, InteriorScene } from "./interiorScene";
import { PALETTE, SELECTION_CAGE, SITE_CONTEXT_LINE } from "./palette";
import { feetInches, mountingHeight, routeDimensions } from "./precise";
import type { ProvenanceClass } from "./provenance";
import { CLASS_CUSTOMER } from "./provenance";
import type { SiteFrame } from "./registration";
import type { PreciseView } from "./store";

const LABEL_STYLE: CSSProperties = { pointerEvents: "none", whiteSpace: "nowrap" };

function Label({ position, text, tone = "room" }: { position: [number, number, number]; text: string; tone?: "room" | "dim" | "reg" | "site" }) {
  return (
    <Html position={position} center style={LABEL_STYLE} zIndexRange={[30, 0]}>
      <span className={`oabm-label oabm-label-${tone}`}>{text}</span>
    </Html>
  );
}

export function RoomLabels({ drawables }: { drawables: Drawable[] }) {
  return (
    <>
      {drawables
        .filter((d) => d.entityKind === "space" && d.labelAnchor)
        .map((d) => <Label key={d.key} position={d.labelAnchor!} text={d.displayName} />)}
    </>
  );
}

/**
 * Mounting heights for devices/equipment; segment lengths for the routes named
 * in `routeKeys`. A segment that runs along the view direction collapses to a
 * point on screen (a vertical drop in plan), so its label is left to the
 * element panel instead of being stacked on top of the device below it.
 */
export function DimensionLabels({ drawables, scene, routeKeys, view }: { drawables: Drawable[]; scene: InteriorScene; routeKeys: Set<string>; view: PreciseView }) {
  const labels: Array<{ key: string; position: [number, number, number]; text: string }> = [];
  const collapses = (d: [number, number, number]) => {
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const along = view === "plan" ? Math.abs(d[2]) : view === "front" ? Math.abs(d[1]) : view === "side" ? Math.abs(d[0]) : 0;
    return along / len > 0.95;
  };
  for (const d of drawables) {
    const mount = mountingHeight(d, scene);
    if (mount && mount.centerAff !== null) {
      const text = d.entityKind === "electrical_equipment" && mount.bottomAff !== null && mount.topAff !== null
        ? `${mount.bottomAff.toFixed(3)}–${mount.topAff.toFixed(3)} m AFF`
        : `${mount.centerAff.toFixed(3)} m AFF · ${feetInches(mount.centerAff)}`;
      labels.push({ key: `${d.key}:aff`, position: [d.center[0], d.center[1], d.bounds.max[2] + 0.12], text });
    }
    if (d.entityKind === "route" && routeKeys.has(d.key)) {
      const dims = routeDimensions(d, scene);
      dims?.segments.forEach((segment) => {
        if (segment.lengthM < 0.3) return;
        if (collapses([segment.to[0] - segment.from[0], segment.to[1] - segment.from[1], segment.to[2] - segment.from[2]])) return;
        labels.push({ key: `${d.key}:seg${segment.index}`, position: segment.midpoint, text: `${segment.lengthM.toFixed(3)} m` });
      });
    }
  }
  return (
    <>
      {labels.map((l) => <Label key={l.key} position={l.position} text={l.text} tone="dim" />)}
    </>
  );
}

/**
 * The interior origin and axes, drawn in the registration's OWN class colour
 * (a placement a person chose is amber, like anything a person specified).
 * Drawn over the walls so the placement is never hidden by what it places.
 */
export function RegistrationMarker({ cls, label }: { cls: ProvenanceClass; label: string }) {
  const color = cls === "inferred" ? PALETTE.inferred.line : PALETTE[cls].fill;
  const z = 0.03;
  const arrow = (dx: number, dy: number): Array<[number, number, number]> => {
    const L = 1.6;
    const tip: [number, number, number] = [dx * L, dy * L, z];
    const back = L - 0.22;
    return [[0, 0, z], tip, tip, [dx * back - dy * 0.1, dy * back + dx * 0.1, z], tip, [dx * back + dy * 0.1, dy * back - dx * 0.1, z]];
  };
  return (
    <group renderOrder={998}>
      <Line points={arrow(1, 0)} segments color={color} lineWidth={4} dashed={cls === "inferred"} depthTest={false} toneMapped={false} renderOrder={998} />
      <Line points={arrow(0, 1)} segments color={color} lineWidth={4} dashed={cls === "inferred"} depthTest={false} toneMapped={false} renderOrder={998} />
      <Label position={[1.85, 0, z]} text="+X" tone="reg" />
      <Label position={[0, 1.85, z]} text="+Y" tone="reg" />
      <Label position={[-0.35, -0.55, z]} text={`${label}: ${CLASS_CUSTOMER[cls].name.toLowerCase()}`} tone="reg" />
    </group>
  );
}

/** The site model's GIS footprint, in world coordinates, at a given height. */
export function FootprintOutline({ footprint, frame, worldY }: { footprint: Position[]; frame: SiteFrame; worldY: number }) {
  const points = useMemo(() => {
    const ring = footprint.map((p) => localMeters(p, frame.center));
    const pts = ring.map(([x, z]) => [x, worldY, z] as [number, number, number]);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last && (first[0] !== last[0] || first[2] !== last[2])) pts.push(first);
    return pts;
  }, [footprint, frame, worldY]);
  if (points.length < 3) return null;
  return (
    <group>
      <Line points={points} color={SITE_CONTEXT_LINE} lineWidth={1.4} dashed toneMapped={false} />
      <Label position={points[0]!} text="GIS footprint (site model)" tone="site" />
    </group>
  );
}

/** A 1 m grid in the interior's own frame, lying on the active floor. */
export function PreciseGrid({ scene, z }: { scene: InteriorScene; z: number }) {
  const { min, max } = scene.meta.bounds;
  const minX = Math.floor(min[0]) - 1;
  const minY = Math.floor(min[1]) - 1;
  const sizeM = Math.max(Math.ceil(max[0]) + 1 - minX, Math.ceil(max[1]) + 1 - minY);
  return (
    <gridHelper
      args={[sizeM, sizeM, "#8b9895", "#c3cbc8"]}
      position={[minX + sizeM / 2, minY + sizeM / 2, z]}
      rotation={[Math.PI / 2, 0, 0]}
      renderOrder={0}
    />
  );
}

export function SelectionCage({ drawable }: { drawable: Drawable }) {
  const points = useMemo(() => {
    const { min, max } = drawable.bounds;
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const pad = Math.max(span * 0.06, 0.04);
    const lo = [min[0] - pad, min[1] - pad, min[2] - pad];
    const hi = [max[0] + pad, max[1] + pad, max[2] + pad];
    const c = [
      [lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]],
      [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]],
    ] as Array<[number, number, number]>;
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    return edges.flatMap(([a, b]) => [c[a!]!, c[b!]!]);
  }, [drawable]);
  return <Line points={points} segments color={SELECTION_CAGE} lineWidth={2} depthTest={false} transparent opacity={0.95} toneMapped={false} renderOrder={999} />;
}

export function worldBoxOf(drawables: Drawable[], matrix: THREE.Matrix4) {
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const d of drawables) {
    const { min, max } = d.bounds;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      box.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix));
    }
  }
  return box;
}
