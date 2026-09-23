/*
 * InteriorOverlay.tsx -- the DOM side of the interior: legend, placement,
 * levels, categories, search, circuits, the drawing parameters, the element
 * panel, and the render stamp. Ported from the E4 viewer's panels
 * (viewer-ui.js); the placement, cutaway and precise sections are new.
 *
 * GENERIC-TITLE MODE is a mode, not a post-process: when it is on, identifying
 * strings (model name/id, registration name, notes and coordinates, input
 * hashes) are never rendered, so they can never land in a captured frame.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { InteriorController } from "./controller";
import { useInteriorScene } from "./controller";
import {
  MIN_DRAWN_THICKNESS_LABEL,
  MIN_DRAWN_THICKNESS_OPTIONS,
  formatThicknessParameter,
  normaliseMinDrawnThickness,
} from "./displayThickness";
import { browseIndex, filterSummary, isolateCategory, isolateKey, search, setLevel, showAll, toggleCategory } from "./interaction";
import type { Drawable, InteriorScene, LayerId } from "./interiorScene";
import { titleCase } from "./interiorScene";
import { INTERIOR_CSS } from "./interiorStyles";
import { feetInches, formatDimension, mountingHeight, routeDimensions } from "./precise";
import { CLASSES, CLASS_CUSTOMER, CLASS_LABEL, classifyRecord, disagreementNote, type ProvenanceClass } from "./provenance";
import { computeRenderStamp, type RenderStamp } from "./renderStamp";
import { useInteriorState, type InteriorMode, type InteriorStore, type PreciseView } from "./store";

const GENERIC_TITLE = "Building model";

function Pill({ cls }: { cls: ProvenanceClass }) {
  return <span className={`oabm-pill oabm-pill-${cls}`}>{CLASS_CUSTOMER[cls].name}</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="oabm-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function confidenceWord(value: unknown) {
  if (typeof value !== "number") return null;
  if (value >= 0.85) return "high confidence";
  if (value >= 0.5) return "medium confidence";
  if (value > 0) return "low confidence";
  return "no stated confidence";
}

export function InteriorOverlay({ controller }: { controller: InteriorController }) {
  const { store } = controller;
  const scene = useInteriorScene(controller);
  const selectedKey = useInteriorState(store, (s) => s.selectedKey);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const mode = useInteriorState(store, (s) => s.mode);

  // Tell the camera how much canvas the panels cover.
  useLayoutEffect(() => {
    const measure = () => {
      const left = leftRef.current ? leftRef.current.getBoundingClientRect().right : 0;
      const right = rightRef.current ? window.innerWidth - rightRef.current.getBoundingClientRect().left : 0;
      const narrow = window.innerWidth <= 900;
      store.set((s) => (s.insets.left === left && s.insets.right === right) || narrow ? {} : { insets: { left, right } });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [store, selectedKey, mode]);

  const selected = selectedKey ? scene.byKey[selectedKey] ?? null : null;
  return (
    <div className="oabm-overlay" data-testid="interior-overlay">
      <style>{INTERIOR_CSS}</style>
      {scene.meta.synthetic ? (
        <div className="oabm-banner oabm-banner-synthetic" role="note">
          SYNTHETIC SAMPLE INTERIOR: made-up rooms, devices and wiring. It is not the interior of the building shown, or of any real building.
        </div>
      ) : null}
      <LeftPanel controller={controller} scene={scene} panelRef={leftRef} />
      {selected ? <ElementPanel controller={controller} scene={scene} drawable={selected} panelRef={rightRef} /> : null}
      <SummaryLine store={store} scene={scene} />
      <ScaleAndCompass store={store} />
      <StampFooter controller={controller} scene={scene} />
    </div>
  );
}

// ---------------------------------------------------------------- left panel --

function LeftPanel({ controller, scene, panelRef }: { controller: InteriorController; scene: InteriorScene; panelRef: RefObject<HTMLDivElement | null> }) {
  const { store, generic } = controller;
  const mode = useInteriorState(store, (s) => s.mode);
  const registered = Boolean(controller.transform);
  const setMode = (next: InteriorMode) => store.set((s) => ({ mode: next, frameRequest: s.frameRequest + 1, cameraIntent: "frame" }));
  const title = generic ? GENERIC_TITLE : scene.meta.name;

  return (
    <div className="oabm-panel oabm-left" ref={panelRef} data-testid="interior-left-panel">
      <p className="oabm-eyebrow">Interior · canonical building model</p>
      <h2>{title}</h2>
      <p className="oabm-muted oabm-tiny">
        {scene.drawables.length} elements · {scene.levels.length} level{scene.levels.length === 1 ? "" : "s"} · {scene.circuits.length} circuit{scene.circuits.length === 1 ? "" : "s"}
      </p>
      <div className="oabm-seg" role="tablist" aria-label="Interior view">
        {(["off", "cutaway", "precise"] as InteriorMode[]).map((m) => (
          <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} disabled={!registered && m !== "off"}>
            {m === "off" ? "Exterior only" : m === "cutaway" ? "Cutaway" : "Precise"}
          </button>
        ))}
      </div>
      <p className="oabm-muted oabm-tiny">
        {mode === "cutaway"
          ? "The stylised exterior is cut away above the cut plane so the interior shows in its true colours. The interior itself is never cut."
          : mode === "precise"
            ? "Exact canonical geometry, orthographic, with mounting heights and conduit lengths. The stylised site is hidden; the GIS footprint is outlined."
            : "Only the stylised exterior is drawn."}
      </p>
      <Legend scene={scene} />
      <Placement controller={controller} />
      {registered && mode !== "off" ? (
        <>
          <Levels store={store} scene={scene} />
          <ViewControls store={store} mode={mode} />
          <Categories store={store} scene={scene} />
          <Find store={store} scene={scene} />
          <Circuits store={store} scene={scene} />
        </>
      ) : null}
      <DrawingParameters store={store} scene={scene} />
      <Assumptions scene={scene} />
    </div>
  );
}

function Legend({ scene }: { scene: InteriorScene }) {
  return (
    <Section title="What the colours claim">
      {CLASSES.map((cls) => (
        <div className="oabm-legend-row" key={cls}>
          <span className={`oabm-sw oabm-sw-${cls}`} />
          <b>{CLASS_CUSTOMER[cls].name}</b>
          <span className="oabm-count">{scene.meta.classCounts[cls]}</span>
          <p>{CLASS_CUSTOMER[cls].blurb}{cls === "inferred" ? " Always dashed, never filled." : ""}</p>
        </div>
      ))}
      <p className="oabm-muted oabm-tiny">
        Filled = the shape comes from recorded dimensions. Dashed = do not trust the shape: inferred, invented by the viewer, or drawn thicker than recorded.
      </p>
    </Section>
  );
}

function Placement({ controller }: { controller: InteriorController }) {
  const { input, transform, generic, footprintCheck } = controller;
  const reg = input.registration;
  if (!reg || !transform) {
    return (
      <Section title="Placement on the site">
        <p className="oabm-warn">
          Not placed. {input.registrationErrors.length ? "The registration supplied was refused: " + input.registrationErrors.join("; ") : "No registration was supplied."} Placing the interior
          would mean guessing a rotation, position and floor elevation, and this viewer does not guess a placement. It is not drawn on the site.
        </p>
      </Section>
    );
  }
  const cls = input.registrationVerdict?.cls ?? "inferred";
  const deg = (transform.rotation_rad * 180) / Math.PI;
  return (
    <Section title="Placement on the site">
      <Pill cls={cls} />
      <p className="oabm-muted">
        {cls === "user"
          ? "A person chose where this interior sits on the site. That is a decision, not a measurement."
          : cls === "observed"
            ? "The placement was measured from a source."
            : "Nobody measured or chose this placement; treat it as a proposal."}
      </p>
      <dl className="oabm-kv">
        {!generic && reg.name ? <><dt>Registration</dt><dd>{reg.name}</dd></> : null}
        <dt>Rotation</dt><dd>{deg.toFixed(2)}° from east (counter-clockwise)</dd>
        <dt>Floor z = 0 at</dt><dd>{generic ? "hidden (generic mode)" : `${reg.elevation_m.toFixed(3)} m elevation`}</dd>
        {!generic ? <><dt>Origin</dt><dd>{transform.anchorEastM.toFixed(2)} m E, {transform.anchorNorthM.toFixed(2)} m N of site centre</dd></> : <><dt>Origin</dt><dd>hidden (generic mode)</dd></>}
        {footprintCheck ? (
          <>
            <dt>Vs GIS footprint</dt>
            <dd>
              {footprintCheck.outsidePoints === 0
                ? `all ${footprintCheck.checkedPoints} wall/floor corners inside`
                : `${footprintCheck.outsidePoints} of ${footprintCheck.checkedPoints} corners outside, by up to ${footprintCheck.maxOutsideM.toFixed(2)} m`}
            </dd>
          </>
        ) : null}
      </dl>
      {!generic && reg.notes ? <p className="oabm-muted oabm-tiny">{reg.notes}</p> : null}
      <DeclaredGeoreference controller={controller} />
    </Section>
  );
}

function DeclaredGeoreference({ controller }: { controller: InteriorController }) {
  const cs = controller.input.model.coordinate_system;
  if (!cs.crs && !cs.origin_in_crs) return null;
  return <p className="oabm-muted oabm-tiny">The model also declares its own georeference ({cs.crs ?? "no CRS"}); it is reported, not used. Only the registration places the interior.</p>;
}

function Levels({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const filter = useInteriorState(store, (s) => s.filter);
  if (!scene.levels.length) return null;
  const choose = (levelId: string | null) => store.set((s) => ({ filter: setLevel(s.filter, levelId), frameRequest: s.frameRequest + 1, cameraIntent: "frame" }));
  return (
    <Section title="Floor levels">
      <div className="oabm-list">
        <button className={filter.levelId === null ? "on" : ""} onClick={() => choose(null)}>
          <span className="grow">All levels</span>
        </button>
        {[...scene.levels].reverse().map((level) => (
          <button key={level.id} className={filter.levelId === level.id ? "on" : ""} onClick={() => choose(level.id)}>
            <span className="grow">{level.name}</span>
            <span className="oabm-count">{level.elevation_m.toFixed(2)} m · {level.drawableKeys.length}</span>
          </button>
        ))}
      </div>
      {scene.unlevelledKeys.length ? (
        <p className="oabm-muted oabm-tiny">{scene.unlevelledKeys.length} element(s) reach no level through their references and are shown with every level.</p>
      ) : null}
    </Section>
  );
}

function ViewControls({ store, mode }: { store: InteriorStore; mode: InteriorMode }) {
  const cut = useInteriorState(store, (s) => s.cutHeightM);
  const view = useInteriorState(store, (s) => s.preciseView);
  const labels = useInteriorState(store, (s) => s.showLabels);
  const setView = (next: PreciseView) => store.set((s) => ({ preciseView: next, frameRequest: s.frameRequest + 1, cameraIntent: "frame" }));
  return (
    <Section title={mode === "precise" ? "Precise view" : "Cutaway"}>
      {mode === "precise" ? (
        <div className="oabm-seg">
          {(["plan", "front", "side", "iso"] as PreciseView[]).map((v) => (
            <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {v === "plan" ? "Plan" : v === "front" ? "Elev. +Y" : v === "side" ? "Elev. −X" : "Iso"}
            </button>
          ))}
        </div>
      ) : null}
      <label className="oabm-muted" htmlFor="oabm-cut">
        Cut plane: <b>{cut.toFixed(2)} m</b> ({feetInches(cut)}) above the active level's floor
      </label>
      <input id="oabm-cut" className="oabm-range" type="range" min={0.3} max={6} step={0.05} value={cut} onChange={(e) => store.set({ cutHeightM: Number(e.target.value) })} />
      <div className="oabm-btnrow">
        <button className="oabm-btn" onClick={() => store.set((s) => ({ frameRequest: s.frameRequest + 1, cameraIntent: "frame" }))}>Fit interior</button>
        <button className="oabm-btn" onClick={() => store.set({ showLabels: !labels })}>{labels ? "Hide labels" : "Show labels"}</button>
      </div>
    </Section>
  );
}

function Categories({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const filter = useInteriorState(store, (s) => s.filter);
  return (
    <Section title="Categories">
      {scene.layers.filter((l) => l.count > 0).map((layer) => {
        const off = filter.isolatedCategory ? filter.isolatedCategory !== layer.id : Boolean(filter.categoriesOff[layer.id]);
        return (
          <div key={layer.id} className={`oabm-cat${off ? " off" : ""}`}>
            <span>{layer.customerLabel} <span className="oabm-count">{layer.count}</span>{layer.id === "conductors" ? <span className="oabm-muted oabm-tiny"> (drawn when zoomed in)</span> : null}</span>
            <button className={`oabm-chip${filter.categoriesOff[layer.id] ? "" : " on"}`} onClick={() => store.set((s) => ({ filter: toggleCategory(s.filter, layer.id as LayerId) }))} title="Show or hide">
              {filter.categoriesOff[layer.id] ? "hidden" : "shown"}
            </button>
            <button className={`oabm-chip${filter.isolatedCategory === layer.id ? " on" : ""}`} onClick={() => store.set((s) => ({ filter: isolateCategory(s.filter, layer.id as LayerId) }))} title="Show only this category">
              only
            </button>
          </div>
        );
      })}
      <div className="oabm-btnrow">
        <button className="oabm-btn" onClick={() => store.set((s) => ({ filter: showAll(), circuitId: null, frameRequest: s.frameRequest + 1, cameraIntent: "frame" }))}>Show everything</button>
      </div>
    </Section>
  );
}

function Find({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const text = useInteriorState(store, (s) => s.searchText);
  const filter = useInteriorState(store, (s) => s.filter);
  const hits = useMemo(() => search(scene, text, 12), [scene, text]);
  const groups = useMemo(() => (text ? [] : browseIndex(scene, filter).filter((g) => ["equipment", "devices"].includes(g.id))), [scene, filter, text]);
  const select = (key: string) => store.set((s) => ({ selectedKey: key, focusRequest: s.focusRequest + 1, cameraIntent: "focus" }));
  return (
    <Section title="Find an element">
      <input className="oabm-input" placeholder="Search: receptacle, panel, Room A…" value={text} onChange={(e) => store.set({ searchText: e.target.value })} />
      <div className="oabm-list" style={{ marginTop: 5 }}>
        {text
          ? hits.map((hit) => (
              <button key={hit.key} onClick={() => select(hit.key)}>
                <span className={`oabm-sw oabm-sw-${hit.cls}`} style={{ width: 14, height: 9 }} />
                <span className="grow">{hit.name}</span>
                <span className="oabm-count">{hit.kind}</span>
              </button>
            ))
          : groups.flatMap((group) => group.items.map((item) => (
              <button key={item.key} onClick={() => select(item.key)} style={{ opacity: item.visible ? 1 : 0.5 }}>
                <span className={`oabm-sw oabm-sw-${item.cls}`} style={{ width: 14, height: 9 }} />
                <span className="grow">{item.name}</span>
                <span className="oabm-count">{item.kind}</span>
              </button>
            )))}
        {text && !hits.length ? <p className="oabm-muted oabm-tiny">Nothing matches.</p> : null}
      </div>
    </Section>
  );
}

function Circuits({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const circuitId = useInteriorState(store, (s) => s.circuitId);
  if (!scene.circuits.length) return null;
  return (
    <Section title="Trace a circuit">
      <div className="oabm-list">
        {scene.circuits.map((c) => (
          <button key={c.id} className={circuitId === c.id ? "on" : ""} onClick={() => store.set({ circuitId: circuitId === c.id ? null : c.id })}>
            <span className={`oabm-sw oabm-sw-${c.verdict.cls}`} style={{ width: 14, height: 9 }} />
            <span className="grow">{c.name}</span>
            <span className="oabm-count">{c.voltage_v ? `${c.voltage_v} V · ` : ""}{c.loadKeys.length ? `${new Set(c.loadKeys).size} loads` : ""}</span>
          </button>
        ))}
      </div>
      {circuitId ? <p className="oabm-muted oabm-tiny">Everything outside the traced circuit is dimmed, never recoloured: a traced inferred run stays dashed.</p> : null}
    </Section>
  );
}

function DrawingParameters({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const value = useInteriorState(store, (s) => s.minDrawnThicknessM);
  const options = MIN_DRAWN_THICKNESS_OPTIONS.some((o) => o.value === value)
    ? MIN_DRAWN_THICKNESS_OPTIONS
    : [...MIN_DRAWN_THICKNESS_OPTIONS, { value, label: formatThicknessParameter(value) }];
  const n = scene.meta.substitutionCount;
  return (
    <Section title="Drawing parameters">
      <label className="oabm-muted" htmlFor="oabm-thickness">{MIN_DRAWN_THICKNESS_LABEL}</label>
      <select id="oabm-thickness" className="oabm-select" value={String(value)} onChange={(e) => store.set({ minDrawnThicknessM: normaliseMinDrawnThickness(e.target.value) })}>
        {options.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
      </select>
      <p className="oabm-muted oabm-tiny" data-testid="thickness-note">
        {value === 0
          ? "Every element is drawn at exactly the thickness the model records. Some may be too thin to see."
          : n === 0
            ? "No element is thinner than this, so nothing is drawn thicker than the model records."
            : `${n} element${n === 1 ? " is" : "s are"} drawn thicker than the model records so they can be seen. This changes the picture only: the model is unchanged and nothing here reaches an export or a quantity.`}
      </p>
    </Section>
  );
}

function Assumptions({ scene }: { scene: InteriorScene }) {
  const inferred = scene.meta.classCounts.inferred;
  const bits: string[] = [];
  if (inferred) bits.push(`${inferred} of ${scene.drawables.length} elements are dashed: no source shows them, so the tool worked them out. Click one to see why.`);
  if (scene.meta.substitutionCount) {
    bits.push(`${scene.meta.substitutionCount} element(s) are DRAWN ${formatThicknessParameter(scene.meta.displaySettings.minDrawnThickness_m)} thick because their source does not report a thickness; a choice about this picture, not a measurement.`);
  }
  if (!bits.length) return null;
  return <Section title="What this drawing assumes"><p className="oabm-note">{bits.join(" ")}</p></Section>;
}

// ------------------------------------------------------------- element panel --

/* Canonical field -> what a building owner would call it. Fields with no entry
 * are shown only in the developer detail, so a raw name never leaks. */
const FRIENDLY: Record<string, { label: string; unit?: string; title?: boolean }> = {
  thickness_m: { label: "Thickness", unit: "m" },
  height_m: { label: "Height", unit: "m" },
  nominal_diameter_m: { label: "Conduit size", unit: "m" },
  rated_voltage_v: { label: "Voltage", unit: "V" },
  voltage_v: { label: "Voltage", unit: "V" },
  clearance_m: { label: "Required clearance", unit: "m" },
  count: { label: "How many" },
  material: { label: "Material", title: true },
  insulation: { label: "Insulation", title: true },
  device_type: { label: "Type", title: true },
  equipment_type: { label: "Type", title: true },
  opening_type: { label: "Type", title: true },
  obstacle_type: { label: "Type", title: true },
  route_type: { label: "Type", title: true },
  fitting_type: { label: "Type", title: true },
  usage: { label: "Room use", title: true },
  role: { label: "Role", title: true },
  system: { label: "System", title: true },
  size: { label: "Size" },
  circuit_number: { label: "Circuit number" },
  elevation_m: { label: "Elevation", unit: "m" },
};

function FriendlyRows({ drawable }: { drawable: Drawable }) {
  const entity = drawable.entity as Record<string, unknown>;
  const swapped = new Map(drawable.substitutions.map((s) => [s.field, s]));
  const rows: ReactNode[] = [];
  for (const [field, spec] of Object.entries(FRIENDLY)) {
    const value = entity[field];
    if (value === undefined || value === null || value === "") continue;
    const sub = swapped.get(field as "thickness_m");
    if (sub) {
      // The ruling: recorded and drawn side by side, never merged, the drawn one labelled.
      rows.push(<dt key={`${field}-r`}>{spec.label} (recorded)</dt>, <dd key={`${field}-rv`}>{sub.recorded_m} m</dd>);
      rows.push(
        <dt key={`${field}-d`}>{spec.label} (drawn)</dt>,
        <dd key={`${field}-dv`} className="drawn">{Math.round(sub.drawn_m * 10000) / 10000} m<span className="oabm-drawnbadge">drawn, not measured</span></dd>,
      );
      continue;
    }
    let text: string;
    if (field === "size" && typeof value === "object") {
      const v = value as { x?: number; y?: number; z?: number };
      if (v.x === undefined) continue;
      text = `${[v.x, v.y, v.z].map((n) => Math.round((n ?? 0) * 1000) / 1000).join(" × ")} m`;
    } else if (typeof value === "object") {
      continue;
    } else if (spec.unit) {
      text = `${Math.round(Number(value) * 1000) / 1000} ${spec.unit}`;
    } else if (spec.title) {
      text = titleCase(String(value));
    } else {
      text = String(value);
    }
    rows.push(<dt key={field}>{spec.label}</dt>, <dd key={`${field}-v`}>{text}</dd>);
  }
  return rows.length ? <dl className="oabm-kv">{rows}</dl> : null;
}

function PreciseNumbers({ drawable, scene }: { drawable: Drawable; scene: InteriorScene }) {
  const mount = mountingHeight(drawable, scene);
  const route = routeDimensions(drawable, scene);
  const entity = drawable.entity as { pose?: { position: { x: number; y: number; z: number } } };
  const pos = entity.pose?.position;
  if (!mount && !route && !pos) return null;
  return (
    <>
      <h4>Exact numbers (canonical)</h4>
      <dl className="oabm-kv">
        {pos ? <><dt>Position (model)</dt><dd className="oabm-mono">x {pos.x.toFixed(3)} · y {pos.y.toFixed(3)} · z {pos.z.toFixed(3)} m</dd></> : null}
        {mount ? (
          mount.centerAff === null
            ? <><dt>Mounting height</dt><dd>no level reachable; z = {mount.zModel.toFixed(3)} m in the model frame</dd></>
            : (
              <>
                <dt>Centre above floor</dt><dd>{formatDimension(mount.centerAff)}</dd>
                {mount.bottomAff !== null ? <><dt>Bottom above floor</dt><dd>{formatDimension(mount.bottomAff)}</dd></> : null}
                {mount.topAff !== null ? <><dt>Top above floor</dt><dd>{formatDimension(mount.topAff)}</dd></> : null}
                {!mount.hasSize ? <><dt>Extent</dt><dd>not recorded, so no top or bottom is given</dd></> : null}
                <dt>Measured from</dt><dd>{mount.levelName} floor (via {mount.levelBasis})</dd>
              </>
            )
        ) : null}
        {route ? (
          <>
            <dt>Run length</dt><dd>{formatDimension(route.totalM)}</dd>
            <dt>Segments</dt><dd className="oabm-mono">{route.segments.map((s) => `${s.lengthM.toFixed(3)}${s.vertical ? "↕" : ""}`).join(" + ")} m</dd>
            {route.levelElevation !== null ? <><dt>Heights above floor</dt><dd className="oabm-mono">{route.vertices.map((v) => v.aff!.toFixed(3)).join(" → ")} m</dd></> : null}
          </>
        ) : null}
      </dl>
    </>
  );
}

function ElementPanel({ controller, scene, drawable, panelRef }: { controller: InteriorController; scene: InteriorScene; drawable: Drawable; panelRef: RefObject<HTMLDivElement | null> }) {
  const { store, input } = controller;
  const isolated = useInteriorState(store, (s) => s.filter.isolatedKey);
  const verdict = drawable.verdict;
  const records = (drawable.entity.provenance ?? []) as unknown[];
  const note = disagreementNote(verdict);
  const level = drawable.levelId ? scene.levels.find((l) => l.id === drawable.levelId) : null;
  const regCls = input.registrationVerdict?.cls ?? "inferred";
  return (
    <div className="oabm-panel oabm-right" ref={panelRef} data-testid="interior-element-panel">
      <Pill cls={drawable.cls} />
      <h3>{drawable.displayName}</h3>
      <p className="oabm-muted oabm-tiny">{drawable.kindCustomer}{level ? ` · ${level.name}` : " · no level"}</p>
      <p className="oabm-muted">{CLASS_CUSTOMER[drawable.cls].blurb}</p>
      <FriendlyRows drawable={drawable} />
      {drawable.substitutions.map((sub) => (
        <p className="oabm-drawnwhy" key={sub.field}>
          This element is <b>drawn</b> {formatThicknessParameter(sub.drawn_m)} thick. Its source does not report a thickness, so the model records {sub.recorded_m} m,
          too thin to see. The drawn thickness is a choice about the picture, set by the labelled parameter "{MIN_DRAWN_THICKNESS_LABEL}", not a measurement of the
          building, and nothing outside this view uses it.
        </p>
      ))}
      {drawable.prims.some((p) => p.role === "detail") ? (
        <p className="oabm-note">
          {drawable.layer === "conductors"
            ? "Wires are drawn inside their conduit only when you zoom in close enough to see them; from further away they would merge into the dashed conduit line and make it look solid."
            : "The conduit's diameter cage is drawn only when you zoom in close enough to see it; from further away only its dashed centerline is drawn."}
        </p>
      ) : null}
      {drawable.basis === "viewer-placeholder" ? (
        <p className="oabm-note">The model gives this element no shape, so the marker is a stand-in drawn by the viewer; its position is the model's.</p>
      ) : null}

      <h4>Where these numbers came from</h4>
      {records.length ? (
        <div className="oabm-records">
          {records.map((record, i) => {
            const r = record as { method?: string | null; confidence?: number; source_kind?: string; source_id?: string };
            const recordCls = classifyRecord(record).cls;
            const conf = confidenceWord(r.confidence);
            return (
              <div className="oabm-record" key={i}>
                <Pill cls={recordCls} />
                <div style={{ marginTop: 5 }}>{r.method || "no method stated"}</div>
                {conf ? <div className="oabm-muted oabm-tiny">{conf}</div> : null}
                <span className="src">{r.source_kind} · {r.source_id}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="oabm-warn">This element carries no record of where it came from at all, so it is shown as inferred.</p>
      )}
      {note ? <p className="oabm-note" data-testid="disagreement-note">{note}</p> : null}
      {verdict.floor ? (
        <p className="oabm-note">Shown as {CLASS_CUSTOMER[verdict.cls].name} whatever its records say: {verdict.floor.why}.</p>
      ) : null}

      <h4>Placement on the site</h4>
      <p className="oabm-muted">
        <Pill cls={regCls} /> Its position on the site comes from the interior's registration, not from this element's records.
      </p>

      <PreciseNumbers drawable={drawable} scene={scene} />

      <div className="oabm-btnrow">
        <button className="oabm-btn" onClick={() => store.set((s) => ({ filter: isolateKey(s.filter, drawable.key) }))}>
          {isolated === drawable.key ? "Show everything again" : "Show only this"}
        </button>
        <button className="oabm-btn" onClick={() => store.set((s) => ({ focusRequest: s.focusRequest + 1, cameraIntent: "focus" }))}>Zoom to it</button>
        {drawable.circuitIds.map((id) => (
          <button key={id} className="oabm-btn" onClick={() => store.set({ circuitId: id })}>Trace {scene.circuits.find((c) => c.id === id)?.name ?? id}</button>
        ))}
        <button className="oabm-btn" onClick={() => store.set({ selectedKey: null })}>Close</button>
      </div>

      <details className="oabm-details">
        <summary>Developer detail</summary>
        <dl className="oabm-kv">
          <dt>canonical id</dt><dd><code>{drawable.entityId}</code></dd>
          <dt>canonical type</dt><dd>{drawable.kindLabel}</dd>
          <dt>provenance class</dt><dd>{CLASS_LABEL[drawable.cls]}</dd>
          <dt>drawn shape</dt><dd>{drawable.basis}</dd>
          <dt>level basis</dt><dd>{drawable.levelBasis}</dd>
        </dl>
        <h4>Why this class</h4>
        <ul>{verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <h4>How the shape was made</h4>
        <p>{drawable.basisNote}</p>
        <h4>Provenance records (verbatim)</h4>
        <code>{JSON.stringify(records, null, 1)}</code>
      </details>
    </div>
  );
}

// --------------------------------------------------------- footer & widgets --

function SummaryLine({ store, scene }: { store: InteriorStore; scene: InteriorScene }) {
  const filter = useInteriorState(store, (s) => s.filter);
  const mode = useInteriorState(store, (s) => s.mode);
  if (mode === "off") return null;
  return <div className="oabm-summary" data-testid="filter-summary">{filterSummary(filter, scene)}</div>;
}

function ScaleAndCompass({ store }: { store: InteriorStore }) {
  const viewport = useInteriorState(store, (s) => s.viewport);
  const mode = useInteriorState(store, (s) => s.mode);
  if (mode === "off" || !viewport.metresPerPixel) return null;
  const maxPx = 140;
  const raw = viewport.metresPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(raw));
  let choice = power;
  for (const mult of [1, 2, 5, 10]) if (power * mult <= raw) choice = power * mult;
  const px = choice / viewport.metresPerPixel;
  const label = choice >= 1 ? `${Math.round(choice * 100) / 100} m` : `${Math.round(choice * 100)} cm`;
  return (
    <div className="oabm-scale">
      <div className="oabm-scalebar" title={viewport.orthographic ? "Exact across the whole view (orthographic)" : "Exact only at the orbit target (perspective)"}>
        {label}{viewport.orthographic ? "" : " at target"}
        <i style={{ width: px }} />
      </div>
      {viewport.northDeg !== null ? (
        <div className="oabm-compass" title="Direction of geographic north on screen">
          <svg width="46" height="46" viewBox="-23 -23 46 46" aria-label="North arrow">
            <g transform={`rotate(${viewport.northDeg.toFixed(1)})`}>
              <polygon points="0,-15 5,3 0,0 -5,3" fill="#b3261e" />
              <polygon points="0,15 5,3 0,0 -5,3" fill="#9aa5a1" />
              <text x="0" y="-16" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1f2b28">N</text>
            </g>
          </svg>
        </div>
      ) : null}
    </div>
  );
}

function StampFooter({ controller, scene }: { controller: InteriorController; scene: InteriorScene }) {
  const { input, generic, buildInfo } = controller;
  const minDrawn = scene.meta.displaySettings.minDrawnThickness_m;
  const [stamp, setStamp] = useState<RenderStamp | null>(null);
  useEffect(() => {
    let live = true;
    computeRenderStamp({ build: buildInfo, modelText: input.modelText, registrationText: input.registrationText, minDrawnThickness_m: minDrawn })
      .then((s) => { if (live) setStamp(s); })
      .catch(() => { if (live) setStamp(null); });
    return () => { live = false; };
  }, [buildInfo, input.modelText, input.registrationText, minDrawn]);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__SITE_TWIN_RENDER_STAMP__ = stamp;
  }, [stamp]);
  return (
    <>
      {stamp && stamp.problem && stamp.commit ? <div className="oabm-banner oabm-banner-bad" data-testid="unreproducible-banner">{stamp.problem}</div> : null}
      <div className="oabm-footer" data-testid="render-stamp">
        {stamp ? (
          <>
            {stamp.renderId ? <span>render <b>{stamp.renderId}</b></span> : <span className="bad">{stamp.problem}</span>}
            {stamp.commit ? <span>code <b>{stamp.commit.slice(0, 10)}</b> {stamp.dirtyFiles === 0 ? "(tree clean)" : <span className="bad">(tree dirty: {stamp.dirtyFiles ?? "unknown"})</span>}</span> : null}
            {!generic ? <span>model <b>{stamp.modelSha256.slice(0, 10)}</b></span> : null}
            {!generic && stamp.registrationSha256 ? <span>registration <b>{stamp.registrationSha256.slice(0, 10)}</b></span> : null}
            <span>{MIN_DRAWN_THICKNESS_LABEL.toLowerCase()} <b>{formatThicknessParameter(minDrawn)}</b> (applied to {scene.meta.substitutionCount})</span>
            <span>{stamp.renderedAtUtc.replace(/\.\d+Z$/, "Z")}</span>
          </>
        ) : <span>computing render stamp…</span>}
      </div>
    </>
  );
}
