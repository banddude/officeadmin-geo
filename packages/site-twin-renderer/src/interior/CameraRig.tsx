/*
 * CameraRig.tsx -- camera placement for the interior modes.
 *
 * The exterior renderer owns one OrbitControls (makeDefault). This rig never
 * adds a second one; it re-aims the existing controls:
 *
 *   cutaway  perspective, framed on the visible interior from the current
 *            azimuth, 50 degrees above the horizon, with a short minimum
 *            distance so a receptacle can be inspected up close.
 *   precise  ORTHOGRAPHIC camera (mounted here with makeDefault), aligned to
 *            the interior's own axes: a true plan with the interior's +Y up
 *            the screen, or true elevations looking along +Y / -X. No
 *            perspective foreshortening, so a length measured anywhere on the
 *            screen is a length, and the scale bar is exact across the view.
 *   off      the exterior camera and control limits the user had before the
 *            interior was opened are restored.
 *
 * It also reports metres-per-pixel and the on-screen direction of north to the
 * overlay (scale bar, compass), and the world-space dash length every dashed
 * line uses, so dashes stay readable at any zoom.
 */
import { useEffect, useRef } from "react";
import { OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { InteriorStore, InteriorMode, PreciseView } from "./store";
import type { RegistrationTransform } from "./registration";
import { canonicalDirectionToWorld } from "./registration";

interface OrbitLike {
  target: THREE.Vector3;
  minDistance: number;
  maxPolarAngle: number;
  update(): void;
}

export interface FrameTarget {
  /** World-space box to fit. */
  box: THREE.Box3;
  /** Identifies this request; framing happens once per distinct key. */
  key: string;
  /** Tighter fit for a single selected element. */
  focus: boolean;
}

const ELEVATION = (50 * Math.PI) / 180;

export function CameraRig({
  store,
  mode,
  preciseView,
  transform,
  target,
  insets,
  onFramed,
}: {
  store: InteriorStore;
  mode: InteriorMode;
  preciseView: PreciseView;
  transform: RegistrationTransform;
  target: FrameTarget | null;
  insets: { left: number; right: number };
  onFramed: (key: string) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const size = useThree((s) => s.size);
  const saved = useRef<{ position: THREE.Vector3; target: THREE.Vector3; minDistance: number; maxPolarAngle: number } | null>(null);

  useEffect(() => {
    if (!controls) return;
    if (mode === "off") {
      const exterior = saved.current;
      if (exterior && !(camera as THREE.OrthographicCamera).isOrthographicCamera) {
        camera.position.copy(exterior.position);
        controls.target.copy(exterior.target);
        controls.minDistance = exterior.minDistance;
        controls.maxPolarAngle = exterior.maxPolarAngle;
        controls.update();
        saved.current = null;
      }
      return;
    }
    if (!saved.current && !(camera as THREE.OrthographicCamera).isOrthographicCamera) {
      saved.current = { position: camera.position.clone(), target: controls.target.clone(), minDistance: controls.minDistance, maxPolarAngle: controls.maxPolarAngle };
    }
    if (mode === "precise" && !(camera as THREE.OrthographicCamera).isOrthographicCamera) return; // wait for the ortho camera
    if (mode === "cutaway" && (camera as THREE.OrthographicCamera).isOrthographicCamera) return; // wait for perspective to return
    if (!target || target.box.isEmpty()) return;

    controls.minDistance = 0.3;
    controls.maxPolarAngle = mode === "precise" ? Math.PI / 2 : Math.PI * 0.49;
    const center = target.box.getCenter(new THREE.Vector3());
    const xDir = new THREE.Vector3(...canonicalDirectionToWorld(transform, [1, 0, 0]));
    const yDir = new THREE.Vector3(...canonicalDirectionToWorld(transform, [0, 1, 0]));
    const up = new THREE.Vector3(0, 1, 0);

    if (mode === "precise") {
      const ortho = camera as THREE.OrthographicCamera;
      let dir: THREE.Vector3;
      if (preciseView === "plan") dir = up.clone().addScaledVector(yDir, -1e-3);
      else if (preciseView === "front") dir = yDir.clone().negate();
      else if (preciseView === "side") dir = xDir.clone();
      else dir = new THREE.Vector3().addScaledVector(yDir, -0.9).addScaledVector(xDir, -0.55).addScaledVector(up, 0.85);
      dir.normalize();
      ortho.position.copy(center).addScaledVector(dir, 80);
      ortho.near = 0.1;
      ortho.far = 400;
      controls.target.copy(center);
      ortho.lookAt(center);
      ortho.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 0);
      const screenUp = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 1);
      let hx = 0.5;
      let hy = 0.5;
      for (const corner of boxCorners(target.box)) {
        const rel = corner.sub(center);
        hx = Math.max(hx, Math.abs(rel.dot(right)));
        hy = Math.max(hy, Math.abs(rel.dot(screenUp)));
      }
      const usableWidth = Math.max(200, size.width - insets.left - insets.right);
      const margin = target.focus ? 3 : 1.18;
      ortho.zoom = Math.min(usableWidth / (2 * hx * margin), size.height / (2 * hy * margin));
      ortho.updateProjectionMatrix();
      // Centre the fit in the part of the canvas the panels leave free.
      const shift = ((insets.right - insets.left) / 2) / ortho.zoom;
      ortho.position.addScaledVector(right, shift);
      controls.target.addScaledVector(right, shift);
    } else {
      const persp = camera as THREE.PerspectiveCamera;
      const sphere = target.box.getBoundingSphere(new THREE.Sphere());
      const fov = (persp.fov * Math.PI) / 180;
      const radius = Math.max(sphere.radius, target.focus ? 0.6 : 2);
      const distance = (radius / Math.sin(fov / 2)) * (target.focus ? 1.6 : 1.12);
      const horizontal = camera.position.clone().sub(controls.target);
      horizontal.y = 0;
      if (horizontal.lengthSq() < 1e-6) horizontal.copy(yDir).negate();
      horizontal.normalize();
      const dir = horizontal.multiplyScalar(Math.cos(ELEVATION)).add(up.clone().multiplyScalar(Math.sin(ELEVATION)));
      persp.position.copy(center).addScaledVector(dir, distance);
      controls.target.copy(center);
      persp.lookAt(center);
      persp.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(persp.matrixWorld, 0);
      const metresPerPixel = (2 * distance * Math.tan(fov / 2)) / Math.max(1, size.height);
      const shift = ((insets.right - insets.left) / 2) * metresPerPixel;
      persp.position.addScaledVector(right, shift);
      controls.target.addScaledVector(right, shift);
    }
    controls.update();
    onFramed(target.key);
    // `target` identity changes whenever the visible set does; framing follows
    // only an explicit key change so orbiting is never fought.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, mode, preciseView, target?.key, size.width, size.height]);

  // Viewport facts for the overlay, throttled to meaningful changes.
  const frameCount = useRef(0);
  useFrame(() => {
    frameCount.current += 1;
    if (frameCount.current % 6 !== 0 || !controls) return;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    let metresPerPixel: number | null = null;
    if (ortho) metresPerPixel = 1 / (camera as THREE.OrthographicCamera).zoom;
    else {
      const persp = camera as THREE.PerspectiveCamera;
      const d = camera.position.distanceTo(controls.target);
      metresPerPixel = (2 * d * Math.tan(((persp.fov * Math.PI) / 180) / 2)) / Math.max(1, size.height);
    }
    const a = controls.target.clone().project(camera);
    const b = controls.target.clone().add(new THREE.Vector3(0, 0, -1)).project(camera); // world north is -Z
    const dx = (b.x - a.x) * size.width;
    const dy = (b.y - a.y) * size.height;
    const northDeg = Math.hypot(dx, dy) < 1e-6 ? null : (Math.atan2(dx, dy) * 180) / Math.PI;
    const current = store.get().viewport;
    const mppChanged = current.metresPerPixel === null || metresPerPixel === null || Math.abs(current.metresPerPixel - metresPerPixel) / metresPerPixel > 0.02;
    const northChanged = current.northDeg === null || northDeg === null || Math.abs(current.northDeg - northDeg) > 1;
    if (mppChanged || northChanged || current.orthographic !== ortho) {
      store.set({ viewport: { metresPerPixel, northDeg, orthographic: ortho } });
    }
  });

  return mode === "precise" ? <OrthographicCamera makeDefault near={0.1} far={400} position={[0, 200, 0]} /> : null;
}

function boxCorners(box: THREE.Box3) {
  const { min, max } = box;
  const out: THREE.Vector3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}
