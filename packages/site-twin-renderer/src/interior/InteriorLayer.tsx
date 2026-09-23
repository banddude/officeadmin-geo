/*
 * InteriorLayer.tsx -- the interior, inside the Site Twin <Canvas>.
 *
 * Mounted as a child of <SiteTwinScene>. Everything interior hangs under one
 * group named INTERIOR_ROOT_NAME; model elements live in a group carrying the
 * REGISTRATION matrix (canonical frame -> site world), so every drawable is
 * drawn at its exact canonical coordinates and the placement is one explicit,
 * inspectable transform. With no registration nothing is placed on the site.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { DimensionLabels, FootprintOutline, PreciseGrid, RegistrationMarker, RoomLabels, SelectionCage, worldBoxOf } from "./Annotations";
import { CameraRig, type FrameTarget } from "./CameraRig";
import { useInteriorScene, type InteriorController } from "./controller";
import { DrawableView } from "./DrawableView";
import { visibilityOf } from "./interaction";
import { auditInteriorScene } from "./interiorScene";
import { INTERIOR_ROOT_NAME } from "./names";
import { CONDUIT_DETAIL_MIN_PX, PICK_PRIORITY, PRECISE_FILL_OPACITY, WIRE_DETAIL_MIN_PX, type Emphasis } from "./palette";
import { ShellCut } from "./ShellCut";
import { useInteriorState } from "./store";

const NO_OVERRIDES: Partial<Record<string, number>> = {};

type LineMaterialLike = THREE.Material & { isLineMaterial?: boolean; dashed?: boolean; dashSize: number; gapSize: number };

function drawableKeyOf(object: THREE.Object3D | null): string | null {
  for (let o = object; o; o = o.parent) {
    const key = o.userData?.drawableKey;
    if (typeof key === "string") return key;
  }
  return null;
}

function Registered({ matrix, children, ...handlers }: {
  matrix: THREE.Matrix4;
  children: ReactNode;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMissed?: (e: MouseEvent) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    group.matrixAutoUpdate = false;
    group.matrix.copy(matrix);
    group.matrixWorldNeedsUpdate = true;
  }, [matrix]);
  return <group ref={ref} {...handlers}>{children}</group>;
}

export function InteriorLayer({ controller }: { controller: InteriorController }) {
  const { store, transform, input } = controller;
  const mode = useInteriorState(store, (s) => s.mode);
  const filter = useInteriorState(store, (s) => s.filter);
  const selectedKey = useInteriorState(store, (s) => s.selectedKey);
  const hoverKey = useInteriorState(store, (s) => s.hoverKey);
  const circuitId = useInteriorState(store, (s) => s.circuitId);
  const cutHeightM = useInteriorState(store, (s) => s.cutHeightM);
  const preciseView = useInteriorState(store, (s) => s.preciseView);
  const showLabels = useInteriorState(store, (s) => s.showLabels);
  const frameRequest = useInteriorState(store, (s) => s.frameRequest);
  const focusRequest = useInteriorState(store, (s) => s.focusRequest);
  const insetLeft = useInteriorState(store, (s) => s.insets.left);
  const insetRight = useInteriorState(store, (s) => s.insets.right);
  const scene = useInteriorScene(controller);
  const metresPerPixel = useInteriorState(store, (s) => s.viewport.metresPerPixel);

  const matrix = useMemo(() => (transform ? new THREE.Matrix4().fromArray(transform.matrix) : null), [transform]);
  const visible = useMemo(() => scene.drawables.filter((d) => visibilityOf(filter, d).visible), [scene, filter]);
  const audit = useMemo(() => auditInteriorScene(scene), [scene]);

  // The active level: the filtered one, else the top level (cut above everything).
  const activeLevel = filter.levelId
    ? scene.levels.find((l) => l.id === filter.levelId) ?? null
    : scene.levels[scene.levels.length - 1] ?? null;
  const floorZ = activeLevel ? activeLevel.elevation_m : scene.meta.bounds.min[2];
  const originY = transform ? transform.originWorld[1] : 0;
  const cutWorldY = originY + floorZ + cutHeightM;

  const circuitMembers = useMemo(() => {
    if (!circuitId) return null;
    const circuit = scene.circuits.find((c) => c.id === circuitId);
    return circuit ? new Set(circuit.memberKeys) : null;
  }, [scene, circuitId]);
  const emphasisOf = (key: string): Emphasis => {
    if (key === selectedKey) return "selected";
    if (key === hoverKey) return "hover";
    if (circuitMembers && !circuitMembers.has(key)) return "dimmed";
    return "normal";
  };

  // What the camera should fit: the selection after "zoom to it", else the visible set.
  const cameraIntent = useInteriorState(store, (s) => s.cameraIntent);
  const selected = selectedKey ? scene.byKey[selectedKey] ?? null : null;
  const target: FrameTarget | null = useMemo(() => {
    if (!matrix) return null;
    if (cameraIntent === "focus" && selected) {
      return { box: worldBoxOf([selected], matrix), key: `focus:${focusRequest}:${selected.key}:${mode}:${preciseView}`, focus: true };
    }
    const framed = visible.filter((d) => d.layer !== "spaces" || visible.length < 3);
    return { box: worldBoxOf(framed.length ? framed : scene.drawables, matrix), key: `frame:${frameRequest}:${filter.levelId ?? "all"}:${mode}:${preciseView}`, focus: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, cameraIntent, selected?.key, focusRequest, frameRequest, filter.levelId, mode, preciseView, visible.length]);

  const [framedKey, setFramedKey] = useState<string | null>(null);
  const onFramed = useCallback((key: string) => setFramedKey(key), []);

  // Line2 picking tolerance in pixels.
  const raycaster = useThree((s) => s.raycaster);
  useEffect(() => {
    (raycaster.params as unknown as Record<string, unknown>).Line2 = { threshold: 6 };
  }, [raycaster]);

  const pick = useCallback((intersections: THREE.Intersection[]) => {
    const hits = intersections
      .map((hit) => ({ key: drawableKeyOf(hit.object), distance: hit.distance }))
      .filter((hit): hit is { key: string; distance: number } => hit.key !== null && Boolean(scene.byKey[hit.key]));
    if (!hits.length) return null;
    const nearest = Math.min(...hits.map((h) => h.distance));
    let best: { key: string; distance: number; priority: number } | null = null;
    for (const hit of hits) {
      // Fabric is see-through, so what the eye picks is often just behind it;
      // electrical elements win among hits close to the nearest one.
      if (hit.distance > nearest + 2.5) continue;
      const priority = PICK_PRIORITY[scene.byKey[hit.key]!.layer];
      if (!best || priority < best.priority || (priority === best.priority && hit.distance < best.distance)) best = { ...hit, priority };
    }
    return best?.key ?? null;
  }, [scene]);

  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const key = pick(e.intersections);
    if (key) store.set({ selectedKey: key });
  }, [pick, store]);
  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const key = pick(e.intersections);
    store.set({ hoverKey: key });
    document.body.style.cursor = key ? "pointer" : "";
  }, [pick, store]);
  const onPointerOut = useCallback(() => {
    store.set({ hoverKey: null });
    document.body.style.cursor = "";
  }, [store]);
  const onPointerMissed = useCallback(() => store.set({ selectedKey: null }), [store]);

  // Dashes sized in screen terms (~7 px dash, ~4 px gap) at the current zoom.
  const rootRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const root = rootRef.current;
    const mpp = store.get().viewport.metresPerPixel;
    if (!root || !mpp) return;
    const dash = Math.min(1.5, Math.max(0.02, mpp * 7));
    const gap = dash * 0.6;
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material as LineMaterialLike | undefined;
      if (!material || Array.isArray(material) || !material.isLineMaterial || !material.dashed) return;
      if (Math.abs(material.dashSize - dash) > dash * 0.05) {
        material.dashSize = dash;
        material.gapSize = gap;
      }
    });
  });

  // Readiness for scripted captures: a picture is only taken of a framed scene.
  useFrame(() => {
    const expected = mode === "off" || !transform ? "none" : target?.key ?? "none";
    (window as unknown as Record<string, unknown>).__SITE_TWIN_INTERIOR__ = {
      ready: expected === "none" || framedKey === expected,
      mode,
      registered: Boolean(transform),
      drawables: scene.drawables.length,
      visible: visible.length,
      auditProblems: audit.length,
      selectedKey,
      framedKey,
    };
  });

  const registrationCls = input.registrationVerdict?.cls ?? "inferred";
  const showInterior = Boolean(transform && matrix && mode !== "off");
  // Conduit segment lengths are labelled for the selected run or the traced
  // circuit only: labelling every run at once buries the plan in numbers.
  const routeKeysForDims = useMemo(() => {
    const keys = new Set<string>();
    if (selected?.entityKind === "route") keys.add(selected.key);
    const circuit = circuitId ? scene.circuits.find((c) => c.id === circuitId) : null;
    circuit?.routeKeys.forEach((key) => { if (scene.byKey[key]?.entityKind === "route") keys.add(key); });
    return keys;
  }, [selected, circuitId, scene]);
  // Conduit cages and wires only once they span a few pixels; before that they
  // would pile onto the dashed centerline and make an inferred run look solid.
  const showDetailFor = (d: (typeof visible)[number]) => {
    if (d.layer !== "routes" && d.layer !== "conductors") return true;
    if (!metresPerPixel) return false;
    if (d.layer === "routes") {
      const diameter = typeof d.entity.nominal_diameter_m === "number" ? d.entity.nominal_diameter_m : 0.02;
      return diameter / metresPerPixel >= CONDUIT_DETAIL_MIN_PX;
    }
    return 0.02 / metresPerPixel >= WIRE_DETAIL_MIN_PX;
  };
  const fillOpacityTable = mode === "precise" ? PRECISE_FILL_OPACITY : NO_OVERRIDES;

  return (
    <group name={INTERIOR_ROOT_NAME} ref={rootRef}>
      {showInterior ? <ShellCut mode={mode} cutWorldY={cutWorldY} /> : null}
      {transform ? (
        <CameraRig
          store={store}
          mode={showInterior ? mode : "off"}
          preciseView={preciseView}
          transform={transform}
          target={target}
          insets={{ left: insetLeft, right: insetRight }}
          onFramed={onFramed}
        />
      ) : null}
      {showInterior && matrix ? (
        <>
          <Registered matrix={matrix} onClick={onClick} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onPointerMissed={onPointerMissed}>
            {visible.map((d) => (
              <DrawableView key={d.key} drawable={d} emphasis={emphasisOf(d.key)} showDetail={showDetailFor(d)} fillOpacityTable={fillOpacityTable} />
            ))}
          </Registered>
          <Registered matrix={matrix}>
            <RegistrationMarker cls={registrationCls} label="Registration origin" />
            {showLabels ? <RoomLabels drawables={visible} /> : null}
            {mode === "precise" && showLabels ? <DimensionLabels drawables={visible} scene={scene} routeKeys={routeKeysForDims} view={preciseView} /> : null}
            {mode === "precise" ? <PreciseGrid scene={scene} z={floorZ + 0.004} /> : null}
            {selected && visible.includes(selected) ? <SelectionCage drawable={selected} /> : null}
          </Registered>
          {mode === "precise" && controller.footprint ? (
            <FootprintOutline footprint={controller.footprint} frame={controller.siteFrame} worldY={originY + floorZ + 0.02} />
          ) : null}
        </>
      ) : null}
    </group>
  );
}
