/*
 * DrawableView.tsx -- one scene drawable as three.js objects.
 *
 * The provenance rule is enforced twice before anything reaches the GPU:
 * interiorScene.ts refuses to emit triangles for inferred / placeholder /
 * drawn-thicker geometry, and this component only ever builds a mesh from a
 * "triangles" primitive of a drawable whose solidAllowed is true.
 * Everything else is a line; lines of anything that may not be filled are
 * DASHED. Colours are not tone-mapped or fogged, so the swatch in the legend
 * and the element on screen are the same colour.
 */
import { memo, useEffect, useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Drawable } from "./interiorScene";
import { DEFAULT_FILL_OPACITY, FILL_OPACITY, NO_DEPTH_WRITE, PALETTE, emphasise, emphasisedOpacity, type Emphasis } from "./palette";

type Tuple = [number, number, number];

function toTuples(positions: number[]): Tuple[] {
  const out: Tuple[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) out.push([positions[i]!, positions[i + 1]!, positions[i + 2]!]);
  return out;
}

function lineWidthFor(drawable: Drawable, dashed: boolean) {
  switch (drawable.layer) {
    case "routes": return 2.4;
    case "conductors": return 1.1;
    case "spaces": return 1.6;
    case "devices":
    case "equipment": return dashed ? 2.2 : 1.6;
    case "ports":
    case "fittings": return 1.3;
    default: return dashed ? 2 : 1.2;
  }
}

export const DrawableView = memo(function DrawableView({ drawable, emphasis, showDetail, fillOpacityTable }: {
  drawable: Drawable;
  emphasis: Emphasis;
  /** Draw "detail" prims (conduit cage, wires); off when they would be sub-pixel. */
  showDetail: boolean;
  /** Per-kind fill opacity for the current mode: legibility only, never provenance. */
  fillOpacityTable: Partial<Record<string, number>>;
}) {
  const palette = PALETTE[drawable.cls];
  const geometry = useMemo(() => {
    if (!drawable.solidAllowed) return null;
    const tri = drawable.prims.find((p) => p.type === "triangles");
    if (!tri) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tri.positions, 3));
    g.computeVertexNormals();
    return g;
  }, [drawable]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const lineSets = useMemo(
    () => drawable.prims.filter((p) => p.type === "lines" && (showDetail || p.role !== "detail")).map((p) => toTuples(p.positions)),
    [drawable, showDetail],
  );

  const dashed = !drawable.solidAllowed;
  const fillOpacity = fillOpacityTable[drawable.entityKind] ?? FILL_OPACITY[drawable.entityKind] ?? DEFAULT_FILL_OPACITY;
  const lineHex = geometry ? palette.edge : palette.line;
  const userData = useMemo(() => ({ drawableKey: drawable.key, provenanceClass: drawable.cls, geometryBasis: drawable.basis }), [drawable]);

  if (!geometry && !lineSets.length) return null;
  return (
    <group userData={userData} name={`interior:${drawable.key}`}>
      {geometry ? (
        <mesh geometry={geometry} userData={userData} renderOrder={1}>
          <meshLambertMaterial
            color={emphasise(palette.fill, emphasis)}
            transparent
            opacity={emphasisedOpacity(fillOpacity, emphasis)}
            depthWrite={!NO_DEPTH_WRITE.has(drawable.entityKind)}
            side={THREE.DoubleSide}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ) : null}
      {lineSets.map((points, index) => (
        <Line
          key={index}
          points={points}
          segments
          color={emphasise(lineHex, emphasis)}
          lineWidth={lineWidthFor(drawable, dashed)}
          dashed={dashed}
          transparent
          opacity={emphasisedOpacity(dashed ? 0.95 : 0.88, emphasis)}
          toneMapped={false}
          userData={userData}
          renderOrder={2}
        />
      ))}
    </group>
  );
});
