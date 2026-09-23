/*
 * make-synthetic-interior.ts -- writes the MADE-UP sample interior for the
 * public Site Twin demo, and the registration that places it.
 *
 *   pnpm exec tsx scripts/make-synthetic-interior.ts
 *
 * Everything this writes is invented. The rooms, walls, devices, circuits and
 * wiring describe no real building -- not the building the demo exterior
 * shows, and not any other. Numbers are round on purpose so nobody can mistake
 * them for a measurement. The only real-world values used are the demo site
 * model's own public centre point (already committed in
 * apps/site-twin-demo/public/site-twin.json), which the registration needs to
 * say where on that public site this made-up interior is drawn.
 *
 * The three provenance classes are mixed on purpose so every style shows:
 *   observed  "measured" by a synthetic survey that never happened
 *   user      "placed by a person" in a synthetic design session
 *   inferred  "worked out by the tool" (ports, routes, a proposed receptacle)
 * and one wall carries two records that disagree (observed position,
 * unmeasured thickness), exactly like a RoomPlan capture does.
 *
 * Output is deterministic: sorted keys, fixed numbers, no timestamps.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "apps/site-twin-demo/public/interior");
const SITE_MODEL = resolve(ROOT, "apps/site-twin-demo/public/site-twin.json");

const MODEL_ID = "synthetic:site-twin-demo-interior-v1";
const FRAME_ID = "synthetic-interior-frame";
const NOTICE =
  "SYNTHETIC SAMPLE INTERIOR - made-up rooms, devices and wiring for the public Site Twin demo. " +
  "It is not the interior of the building shown, or of any real building.";

type P = { x: number; y: number; z: number };
const p = (x: number, y: number, z: number): P => ({ x, y, z });
const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const ROT_Z90 = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 }; // 90 degrees about +Z

type Derivation = "observed" | "user" | "inferred";
const SOURCES: Record<Derivation, { source_kind: string; source_id: string }> = {
  observed: { source_kind: "synthetic-survey", source_id: "synthetic:sample-survey-001" },
  user: { source_kind: "synthetic-design", source_id: "synthetic:sample-design-session-001" },
  inferred: { source_kind: "synthetic-tool", source_id: "synthetic:sample-tool-run-001" },
};

function prov(derivation: Derivation, method: string, confidence = 1) {
  return {
    attributes: { synthetic: true },
    confidence,
    derivation,
    method,
    page: null,
    source_element_id: null,
    ...SOURCES[derivation],
  };
}
const SURVEYED = (what: string) => prov("observed", `synthetic survey (made up): ${what}`, 0.95);
const DESIGNED = (what: string) => prov("user", `placed by a person in a synthetic design session (made up): ${what}`);
const TOOL = (what: string) => prov("inferred", `worked out by the tool (synthetic): ${what}`, 0.6);

const entity = (id: string, name: string | null, provenance: object[], rest: object) => ({
  attributes: {},
  confidence: 1,
  id,
  name,
  provenance,
  ...rest,
});

const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => ({
  kind: "polygon3d",
  points: [p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)],
});
const line = (...points: P[]) => ({ kind: "polyline3d", points });

// ---- levels -----------------------------------------------------------------
const L1 = "level:l1";
const L2 = "level:l2";
const levels = [
  entity(L1, "Sample Level 1", [DESIGNED("level datum set by hand")], { elevation_m: 0, height_m: 3 }),
  entity(L2, "Sample Level 2", [DESIGNED("level datum set by hand")], { elevation_m: 3.2, height_m: 3 }),
];

// ---- structure --------------------------------------------------------------
const W = 8; // interior plan: 8 m x 7 m, exterior wall centerlines on the rectangle
const D = 7;
const EXT_T = 0.2;
const exteriorWalls = (level: string, z: number, tag: string) => [
  ["south", p(0, 0, z), p(W, 0, z)],
  ["east", p(W, 0, z), p(W, D, z)],
  ["north", p(W, D, z), p(0, D, z)],
  ["west", p(0, D, z), p(0, 0, z)],
].map(([side, a, b]) => entity(`wall:${tag}-${side}`, `Sample ${tag.toUpperCase()} ${side} wall`, [SURVEYED("exterior wall line, height and thickness")], {
  centerline: line(a as P, b as P), height_m: 3, level_id: level, thickness_m: EXT_T,
}));

const walls = [
  ...exteriorWalls(L1, 0, "l1"),
  // Scanned like a RoomPlan capture: position observed, thickness NOT measured,
  // so the model honestly records 0.001 m and says so in a second record.
  entity("wall:l1-partition-scanned", "Sample scanned partition", [
    SURVEYED("partition position and height from a synthetic room scan"),
    prov("inferred", "thickness not captured by the synthetic scan; the importer records 0.001 m rather than invent one", 0.2),
  ], { centerline: line(p(5, 0, 0), p(5, 4, 0)), height_m: 3, level_id: L1, thickness_m: 0.001 }),
  entity("wall:l1-partition-designed", "Sample designed partition", [DESIGNED("partition drawn in a floor-plan editor, 4.5 in")], {
    centerline: line(p(0, 4, 0), p(W, 4, 0)), height_m: 3, level_id: L1, thickness_m: 0.1143,
  }),
  ...exteriorWalls(L2, 3.2, "l2"),
];

const slabs = [
  entity("slab:l1", "Sample Level 1 floor", [SURVEYED("floor outline")], { footprint: rect(0, 0, W, D, 0), level_id: L1, thickness_m: 0.2 }),
  entity("slab:l2", "Sample Level 2 floor", [SURVEYED("floor outline")], { footprint: rect(0, 0, W, D, 3.2), level_id: L2, thickness_m: 0.2 }),
];

const ceilings = [
  entity("ceiling:l1", "Sample Level 1 ceiling", [TOOL("ceiling plane assumed at the top of the walls; thickness unknown")], {
    footprint: rect(0, 0, W, D, 3), level_id: L1, thickness_m: null,
  }),
  entity("ceiling:l2", "Sample Level 2 ceiling", [TOOL("ceiling plane assumed at the top of the walls; thickness unknown")], {
    footprint: rect(0, 0, W, D, 6.2), level_id: L2, thickness_m: null,
  }),
];

const spaces = [
  entity("space:room-a", "Sample Room A", [SURVEYED("room outline")], { footprint: rect(0, 0, 5, 4, 0), height_m: 3, level_id: L1, usage: "living" }),
  entity("space:room-b", "Sample Room B", [SURVEYED("room outline")], { footprint: rect(5, 0, W, 4, 0), height_m: 3, level_id: L1, usage: "bedroom" }),
  entity("space:utility", "Sample Utility Room", [DESIGNED("room drawn by hand")], { footprint: rect(0, 4, W, D, 0), height_m: 3, level_id: L1, usage: "utility" }),
  entity("space:room-d", "Sample Room D", [DESIGNED("room drawn by hand")], { footprint: rect(0, 0, W, D, 3.2), height_m: 3, level_id: L2, usage: "office" }),
];

const openings = [
  entity("opening:l1-window-a", "Sample window A", [SURVEYED("window in the south wall")], {
    host_id: "wall:l1-south", opening_type: "window", pose: { position: p(3.5, 0, 1.5), rotation: IDENTITY }, size: { x: 1.2, y: EXT_T, z: 1.2 },
  }),
  entity("opening:l1-window-b", "Sample window B", [DESIGNED("window added in the design")], {
    host_id: "wall:l1-south", opening_type: "window", pose: { position: p(6.5, 0, 1.5), rotation: IDENTITY }, size: { x: 1, y: EXT_T, z: 1.2 },
  }),
  entity("opening:l1-door-utility", "Sample door to utility room", [SURVEYED("door in the designed partition")], {
    host_id: "wall:l1-partition-designed", opening_type: "door", pose: { position: p(1.5, 4, 1.05), rotation: IDENTITY }, size: { x: 0.9, y: 0.1143, z: 2.1 },
  }),
  entity("opening:l1-door-ab", "Sample doorway A-B", [TOOL("doorway inferred because rooms A and B are otherwise unconnected")], {
    // Rotated 90 degrees about Z: the host partition runs along +Y.
    host_id: "wall:l1-partition-scanned", opening_type: "door",
    pose: { position: p(5, 2, 1.05), rotation: ROT_Z90 }, size: { x: 0.8, y: 0.1, z: 2.1 },
  }),
];

// ---- electrical ---------------------------------------------------------------
const equipment = [
  entity("equipment:panel-p1", "SAMPLE PANEL P1", [
    SURVEYED("panel location and enclosure size"),
    DESIGNED("panel label confirmed by a person"),
  ], {
    equipment_type: "panelboard", host_id: "wall:l1-west", level_id: L1, space_id: "space:utility",
    pose: { position: p(0.1, 5.5, 1.5), rotation: IDENTITY }, rated_voltage_v: 240, size: { x: 0.1, y: 0.6, z: 0.8 }, system: "120/240V-1ph",
  }),
];

const RECEPTACLE_ALONG_X = { x: 0.08, y: 0.05, z: 0.12 };
const RECEPTACLE_ALONG_Y = { x: 0.05, y: 0.08, z: 0.12 };
const device = (id: string, name: string, type: string, provenance: object[], pos: P, size: object | null, level: string, space: string, host: string | null) =>
  entity(id, name, provenance, {
    device_type: type, host_id: host, level_id: level, space_id: space,
    pose: { position: pos, rotation: IDENTITY }, rated_voltage_v: 120, size, system: "120V",
  });

const devices = [
  device("device:r1", "Sample receptacle R1", "receptacle", [SURVEYED("receptacle on the south wall")], p(2.5, 0.1, 0.45), RECEPTACLE_ALONG_X, L1, "space:room-a", "wall:l1-south"),
  device("device:r2", "Sample receptacle R2", "receptacle", [DESIGNED("receptacle placed in the design")], p(4, 6.9, 0.45), RECEPTACLE_ALONG_X, L1, "space:utility", "wall:l1-north"),
  device("device:r3", "Sample receptacle R3 (proposed)", "receptacle", [TOOL("receptacle proposed from a spacing rule; nobody placed it")], p(7.9, 2, 0.45), RECEPTACLE_ALONG_Y, L1, "space:room-b", "wall:l1-east"),
  device("device:s1", "Sample switch S1", "switch", [SURVEYED("switch beside the utility door")], p(2.5, 3.94, 1.2), RECEPTACLE_ALONG_X, L1, "space:room-a", "wall:l1-partition-designed"),
  device("device:l1", "Sample light L1", "luminaire", [DESIGNED("ceiling light placed in the design")], p(1.5, 2, 2.95), { x: 0.3, y: 0.3, z: 0.1 }, L1, "space:room-a", null),
  // Seen by the synthetic survey but never measured: no size, so the viewer
  // must draw a placeholder marker rather than invent a box.
  device("device:j1", "Sample junction box J1", "junction_box", [SURVEYED("junction box seen above the utility ceiling; size not recorded")], p(2.5, 5.3, 2.9), null, L1, "space:utility", null),
  device("device:r4", "Sample receptacle R4", "receptacle", [SURVEYED("receptacle on the upstairs west wall")], p(0.1, 5, 3.65), RECEPTACLE_ALONG_Y, L2, "space:room-d", "wall:l2-west"),
];

const port = (id: string, owner: string, role: string, pos: P, dir: P) =>
  entity(id, null, [TOOL("connection point synthesized so the circuit has an endpoint")], {
    connected_port_ids: [], direction: dir, domain: "power", nominal_diameter_m: 0.02, owner_id: owner, pose: { position: pos, rotation: IDENTITY }, role,
  });
const UP = p(0, 0, 1);
const DOWN = p(0, 0, -1);
const ports = [
  port("port:p1-c1", "equipment:panel-p1", "source", p(0.1, 5.3, 1.9), UP),
  port("port:p1-c2", "equipment:panel-p1", "source", p(0.1, 5.5, 1.9), UP),
  port("port:p1-c3", "equipment:panel-p1", "source", p(0.1, 5.7, 1.9), UP),
  port("port:j1-in", "device:j1", "load", p(2.5, 5.3, 2.9), p(-1, 0, 0)),
  port("port:j1-out-r1", "device:j1", "source", p(2.5, 5.3, 2.9), p(0, -1, 0)),
  port("port:j1-out-r2", "device:j1", "source", p(2.5, 5.3, 2.9), p(1, 0, 0)),
  port("port:r1-in", "device:r1", "load", p(2.5, 0.1, 0.51), UP),
  port("port:r2-in", "device:r2", "load", p(4, 6.9, 0.51), UP),
  port("port:l1-in", "device:l1", "load", p(1.5, 2, 2.95), p(0, 1, 0)),
  port("port:r4-in", "device:r4", "load", p(0.1, 5, 3.71), DOWN),
];

// Routes are router output: centerlines start and end exactly on their ports.
const route = (id: string, name: string, start: string, end: string, points: P[], fittings: string[]) =>
  entity(id, name, [TOOL("conduit path proposed by the router")], {
    centerline: line(...points), end_port_id: end, fitting_ids: fittings, nominal_diameter_m: 0.02, route_type: "emt", start_port_id: start,
  });
const routes = [
  route("route:c1-home", "Sample conduit C1 home run", "port:p1-c1", "port:j1-in", [p(0.1, 5.3, 1.9), p(0.1, 5.3, 2.9), p(2.5, 5.3, 2.9)], ["fitting:c1-home-1"]),
  route("route:c1-r1", "Sample conduit C1 to R1", "port:j1-out-r1", "port:r1-in", [p(2.5, 5.3, 2.9), p(2.5, 0.1, 2.9), p(2.5, 0.1, 0.51)], ["fitting:c1-r1-1"]),
  route("route:c1-r2", "Sample conduit C1 to R2", "port:j1-out-r2", "port:r2-in", [p(2.5, 5.3, 2.9), p(4, 5.3, 2.9), p(4, 6.9, 2.9), p(4, 6.9, 0.51)], ["fitting:c1-r2-1", "fitting:c1-r2-2"]),
  route("route:c2", "Sample conduit C2 to L1", "port:p1-c2", "port:l1-in", [p(0.1, 5.5, 1.9), p(0.1, 5.5, 2.95), p(1.5, 5.5, 2.95), p(1.5, 2, 2.95)], ["fitting:c2-1", "fitting:c2-2"]),
  // A riser that crosses from Level 1 to Level 2: it has no single elevation,
  // so its level must come from references (start port -> panel -> Level 1).
  route("route:c3-riser", "Sample riser C3 to R4", "port:p1-c3", "port:r4-in", [p(0.1, 5.7, 1.9), p(0.1, 5.7, 3.4), p(0.1, 5, 3.4), p(0.1, 5, 3.71)], ["fitting:c3-1", "fitting:c3-2"]),
];

const fitting = (id: string, routeId: string, pos: P) =>
  entity(id, null, [TOOL("elbow selected by the router")], {
    angle_radians: Math.PI / 2, fitting_type: "elbow-90", nominal_diameter_m: 0.02, pose: { position: pos, rotation: IDENTITY }, route_id: routeId,
  });
const fittings = [
  fitting("fitting:c1-home-1", "route:c1-home", p(0.1, 5.3, 2.9)),
  fitting("fitting:c1-r1-1", "route:c1-r1", p(2.5, 0.1, 2.9)),
  fitting("fitting:c1-r2-1", "route:c1-r2", p(4, 5.3, 2.9)),
  fitting("fitting:c1-r2-2", "route:c1-r2", p(4, 6.9, 2.9)),
  fitting("fitting:c2-1", "route:c2", p(0.1, 5.5, 2.95)),
  fitting("fitting:c2-2", "route:c2", p(1.5, 5.5, 2.95)),
  fitting("fitting:c3-1", "route:c3-riser", p(0.1, 5.7, 3.4)),
  fitting("fitting:c3-2", "route:c3-riser", p(0.1, 5, 3.4)),
];

const circuit = (id: string, name: string, number: string, provenance: object[], source: string, loads: string[], routeIds: string[]) =>
  entity(id, name, provenance, {
    circuit_number: number, load_port_ids: loads, load_va: null, phase: "1ph", poles: 1, route_ids: routeIds, source_port_id: source, voltage_v: 120,
  });
const circuits = [
  circuit("circuit:c1", "Sample circuit 1 (receptacles)", "1", [DESIGNED("circuit assignment chosen by a person")], "port:p1-c1", ["port:r1-in", "port:r2-in"], ["route:c1-home", "route:c1-r1", "route:c1-r2"]),
  circuit("circuit:c2", "Sample circuit 2 (lighting)", "2", [TOOL("circuit grouping worked out by the tool")], "port:p1-c2", ["port:l1-in"], ["route:c2"]),
  circuit("circuit:c3", "Sample circuit 3 (upstairs)", "3", [DESIGNED("circuit assignment chosen by a person")], "port:p1-c3", ["port:r4-in"], ["route:c3-riser"]),
];

const conductorSet = (circuitId: string, tag: string, routeIds: string[]) =>
  (["line", "neutral", "ground"] as const).map((role) =>
    entity(`conductor:${tag}-${role}`, null, [TOOL("conductor derived from the circuit and its conduit")], {
      circuit_id: circuitId, count: 1, insulation: role === "ground" ? "bare" : "THHN", material: "copper", role, route_ids: routeIds, size: "12 AWG",
    }));
const conductors = [
  ...conductorSet("circuit:c1", "c1", ["route:c1-home", "route:c1-r1", "route:c1-r2"]),
  ...conductorSet("circuit:c2", "c2", ["route:c2"]),
  ...conductorSet("circuit:c3", "c3", ["route:c3-riser"]),
];

const obstacles = [
  entity("obstacle:duct", "Sample duct", [SURVEYED("duct under the utility ceiling")], {
    clearance_m: 0.05, geometry: { kind: "box3d", pose: { position: p(6.5, 5.5, 2.7), rotation: IDENTITY }, size: { x: 2, y: 0.4, z: 0.3 } }, level_id: L1, obstacle_type: "duct",
  }),
];

const model = {
  attributes: { designed_sample: true, notice: NOTICE, synthetic: true },
  ceilings,
  circuits,
  conductors,
  coordinate_system: {
    angle_unit: "rad", crs: null, frame_id: FRAME_ID, handedness: "right", length_unit: "m", origin_in_crs: null, true_north_radians: null, up_axis: "+Z",
  },
  electrical_devices: devices,
  electrical_equipment: equipment,
  levels,
  model_id: MODEL_ID,
  name: "SYNTHETIC SAMPLE INTERIOR (made up)",
  obstacles,
  openings,
  ports,
  provenance: [prov("user", "hand-written synthetic sample for the public Site Twin demo; describes no real building")],
  route_constraints: [],
  route_fittings: fittings,
  routes,
  schema_version: "1.0.0",
  slabs,
  spaces,
  walls,
};

// ---- registration -------------------------------------------------------------
// Chosen BY HAND for the demo: the made-up interior's origin 5.5 m west and
// 1.1 m south of the public site model's centre, its +X axis rotated -30
// degrees from east, its Level 1 floor at 164.1 m (the demo building's
// published ground elevation, rounded). A person chose it, so it is `user`.
const site = JSON.parse(readFileSync(SITE_MODEL, "utf8")) as { center: { latitude: number; longitude: number } };
const EAST_M = -5.5;
const NORTH_M = -1.1;
const ROTATION_DEG = -30;
const EARTH_RADIUS_M = 6_371_008.8; // site-twin-core geometry.ts
const lat0 = (site.center.latitude * Math.PI) / 180;
const anchor = {
  latitude: round(site.center.latitude + (NORTH_M / EARTH_RADIUS_M) * (180 / Math.PI), 9),
  longitude: round(site.center.longitude + (EAST_M / (EARTH_RADIUS_M * Math.cos(lat0))) * (180 / Math.PI), 9),
};
const registration = {
  anchor,
  attributes: { synthetic: true },
  confidence: 1,
  elevation_m: 164.1,
  id: "registration:synthetic-demo",
  interior: { frame_id: FRAME_ID, model_id: MODEL_ID },
  name: "Synthetic interior placed by hand in the demo footprint",
  notes: `Chosen by hand for the demo: origin ${-EAST_M} m west and ${-NORTH_M} m south of the site model centre, +X rotated ${ROTATION_DEG} deg from east, Level 1 floor at 164.1 m. The interior is made up; only its placement on the public demo site is chosen.`,
  provenance: [
    {
      attributes: { synthetic: true },
      confidence: 1,
      derivation: "user",
      method: "placed by hand for the public demo so the made-up interior sits inside the demo footprint",
      page: null,
      source_element_id: null,
      source_id: "synthetic:demo-registration-001",
      source_kind: "manual-registration",
    },
  ],
  registration_version: "1",
  rotation_rad: (ROTATION_DEG * Math.PI) / 180,
};

function round(value: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "synthetic-interior.json"), `${JSON.stringify(sortKeys(model), null, 2)}\n`);
writeFileSync(resolve(OUT_DIR, "synthetic-interior.registration.json"), `${JSON.stringify(sortKeys(registration), null, 2)}\n`);
console.log(`wrote ${OUT_DIR}/synthetic-interior.json and synthetic-interior.registration.json`);
