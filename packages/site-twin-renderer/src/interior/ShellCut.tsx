/*
 * ShellCut.tsx -- how the interior is seen through the exterior.
 *
 * CHOSEN: a horizontal CUTAWAY of the exterior, not a ghosted shell and not a
 * vertical section.
 *
 *   - Ghosting draws the shell translucent in front of the interior, which tints
 *     every interior element seen through it. The interior's colours ARE its
 *     provenance classes (teal / amber / violet), so a tint over them corrupts
 *     exactly the thing that must stay legible, and the shell's many
 *     overlapping translucent boxes sort differently at every angle.
 *   - A vertical section shows one slice of one floor; electrical work spans
 *     the whole plan (a panel on one wall, receptacles on the others).
 *   - A horizontal cut removes the shell ABOVE a plane at the active level's
 *     floor + a cut height (default 1.2 m, the architectural plan-cut
 *     convention), so the interior is seen directly, in its true colours,
 *     while the shell below the cut still shows where the exterior walls are.
 *     The interior itself is NEVER clipped: ceiling lights and conduit above
 *     the cut height stay visible.
 *
 * Mechanics: the exterior's materials are declared inside SiteTwinScene.tsx, so
 * rather than threading a prop through that file this walks the scene each
 * frame and sets `clippingPlanes` on built-in mesh materials:
 *   cutaway  -> the primary building group only (found by name)
 *   precise  -> exterior meshes are hidden. Clipping them at the cut plane
 *               left trees in front of the elevation and its dimension labels.
 *               The precise view draws its own grid and GIS footprint outline.
 *   off      -> nothing is clipped; everything is restored
 * It is idempotent per frame and restores every material on unmount.
 */
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { InteriorMode } from "./store";
import { INTERIOR_ROOT_NAME, PRIMARY_BUILDING_GROUP_NAME } from "./names";

type ClippableMaterial = THREE.Material & { clippingPlanes: THREE.Plane[] | null; clipShadows: boolean };

function isBuiltInMeshMaterial(material: THREE.Material): material is ClippableMaterial {
  const m = material as THREE.Material & Record<string, unknown>;
  return Boolean(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial || m.isMeshPhongMaterial);
}

function setClip(material: THREE.Material | THREE.Material[], want: THREE.Plane[] | null) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (!isBuiltInMeshMaterial(m)) continue;
    if (m.clippingPlanes === want) continue;
    m.clippingPlanes = want;
    m.clipShadows = want !== null;
    m.needsUpdate = true;
  }
}

function walk(object: THREE.Object3D, inPrimary: boolean, visit: (mesh: THREE.Mesh, inPrimary: boolean) => void) {
  if (object.name === INTERIOR_ROOT_NAME) return;
  const primary = inPrimary || object.name === PRIMARY_BUILDING_GROUP_NAME;
  if ((object as THREE.Mesh).isMesh) visit(object as THREE.Mesh, primary);
  for (const child of object.children) walk(child, primary, visit);
}

export function ShellCut({ mode, cutWorldY }: { mode: InteriorMode; cutWorldY: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const planes = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)], []);
  const hidden = useMemo(() => new Map<THREE.Mesh, boolean>(), []);

  useFrame(() => {
    planes[0]!.constant = cutWorldY;
    if (!gl.localClippingEnabled) gl.localClippingEnabled = true;
    const primary = scene.getObjectByName(PRIMARY_BUILDING_GROUP_NAME);
    if (primary) primary.visible = mode !== "precise";
    walk(scene, false, (mesh, inPrimary) => {
      if (mode === "precise" && !inPrimary) {
        if (!hidden.has(mesh)) hidden.set(mesh, mesh.visible);
        mesh.visible = false;
      } else if (hidden.has(mesh)) {
        mesh.visible = hidden.get(mesh)!;
        hidden.delete(mesh);
      }
      const want = mode === "cutaway" && inPrimary ? planes : null;
      setClip(mesh.material, want);
    });
  });

  useEffect(() => () => {
    const primary = scene.getObjectByName(PRIMARY_BUILDING_GROUP_NAME);
    if (primary) primary.visible = true;
    walk(scene, false, (mesh) => setClip(mesh.material, null));
    for (const [mesh, wasVisible] of hidden) mesh.visible = wasVisible;
    hidden.clear();
  }, [scene, hidden]);

  return null;
}
