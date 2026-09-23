/*
 * parseModel.ts -- accept or REFUSE a canonical BuildingModel document.
 *
 * The canonical contract says a consumer must fail at its handoff boundary
 * rather than silently invent a divergent interpretation, and the Python
 * reader (oabm.model) is strict on purpose. This mirrors the checks a drawing
 * depends on: the schema's exact field sets (additionalProperties: false), the
 * coordinate/unit constants, finite and positive dimensions, the derivation
 * enum, and the reference-integrity rules of oabm/model/model.py
 * (validate_model) -- duplicate ids, dangling references, route endpoints that
 * must sit on their ports, fitting ownership, symmetric port connectivity.
 *
 * It collects EVERY problem with a JSON path instead of stopping at the first,
 * so a refused document says all of what is wrong with it.
 */
import { CANONICAL_SCHEMA_VERSION, type BuildingModel } from "./canonical";

export type ParseResult =
  | { ok: true; model: BuildingModel; warnings: string[] }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const EPS = 1e-9;

const COMMON = ["id", "name", "confidence", "provenance", "attributes"];
const ALLOWED: Record<string, string[]> = {
  levels: [...COMMON, "elevation_m", "height_m"],
  spaces: [...COMMON, "level_id", "footprint", "height_m", "usage"],
  walls: [...COMMON, "level_id", "centerline", "thickness_m", "height_m"],
  slabs: [...COMMON, "level_id", "footprint", "thickness_m"],
  ceilings: [...COMMON, "level_id", "footprint", "thickness_m"],
  openings: [...COMMON, "host_id", "opening_type", "pose", "size"],
  electrical_equipment: [...COMMON, "equipment_type", "host_id", "level_id", "pose", "rated_voltage_v", "size", "space_id", "system"],
  electrical_devices: [...COMMON, "device_type", "host_id", "level_id", "pose", "rated_voltage_v", "size", "space_id", "system"],
  ports: [...COMMON, "owner_id", "domain", "role", "pose", "direction", "nominal_diameter_m", "connected_port_ids"],
  obstacles: [...COMMON, "obstacle_type", "geometry", "level_id", "clearance_m"],
  route_constraints: [...COMMON, "constraint_type", "geometry", "level_id", "hard", "clearance_m", "applies_to"],
  routes: [...COMMON, "route_type", "start_port_id", "end_port_id", "centerline", "nominal_diameter_m", "fitting_ids"],
  route_fittings: [...COMMON, "route_id", "fitting_type", "pose", "nominal_diameter_m", "angle_radians"],
  circuits: [...COMMON, "source_port_id", "load_port_ids", "route_ids", "circuit_number", "voltage_v", "poles", "phase", "load_va"],
  conductors: [...COMMON, "circuit_id", "role", "route_ids", "material", "size", "count", "insulation"],
};
const TOP_LEVEL = new Set(["model_id", "schema_version", "coordinate_system", "name", "provenance", "attributes", ...Object.keys(ALLOWED)]);
const PROVENANCE_KEYS = new Set(["source_kind", "source_id", "source_element_id", "page", "method", "confidence", "derivation", "attributes"]);
const CS_KEYS = new Set(["frame_id", "handedness", "up_axis", "length_unit", "angle_unit", "crs", "origin_in_crs", "true_north_radians"]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

class Checker {
  errors: string[] = [];
  warnings: string[] = [];
  fail(path: string, message: string) { this.errors.push(`${path}: ${message}`); }

  keys(path: string, value: Json, allowed: Iterable<string>) {
    const set = new Set(allowed);
    for (const key of Object.keys(value)) if (!set.has(key)) this.fail(`${path}.${key}`, "is not a field of the canonical contract");
  }
  string(path: string, value: unknown, { nullable = false, required = true } = {}) {
    if (value === undefined) { if (required) this.fail(path, "is required"); return; }
    if (value === null) { if (!nullable) this.fail(path, "must not be null"); return; }
    if (typeof value !== "string" || !value) this.fail(path, "must be a non-empty string");
  }
  id(path: string, value: unknown, { nullable = false, required = true } = {}) {
    if (value === undefined) { if (required) this.fail(path, "is required"); return; }
    if (value === null) { if (!nullable) this.fail(path, "must not be null"); return; }
    if (typeof value !== "string" || !ID_PATTERN.test(value)) this.fail(path, `must match ${ID_PATTERN}`);
  }
  number(path: string, value: unknown, { required = true, nullable = false, positive = false, nonNegative = false, unit = false } = {}) {
    if (value === undefined) { if (required) this.fail(path, "is required"); return; }
    if (value === null) { if (!nullable) this.fail(path, "must not be null"); return; }
    if (!isFiniteNumber(value)) { this.fail(path, "must be a finite number"); return; }
    if (positive && !(value > 0)) this.fail(path, "must be greater than 0");
    if (nonNegative && value < 0) this.fail(path, "must not be negative");
    if (unit && (value < 0 || value > 1)) this.fail(path, "must be between 0 and 1");
  }
  point(path: string, value: unknown) {
    if (!isObject(value)) { this.fail(path, "must be a Point3 object"); return; }
    this.keys(path, value, ["x", "y", "z"]);
    for (const axis of ["x", "y", "z"]) this.number(`${path}.${axis}`, value[axis]);
  }
  size(path: string, value: unknown) {
    if (!isObject(value)) { this.fail(path, "must be a Size3 object"); return; }
    this.keys(path, value, ["x", "y", "z"]);
    for (const axis of ["x", "y", "z"]) this.number(`${path}.${axis}`, value[axis], { positive: true });
  }
  vector(path: string, value: unknown) {
    this.point(path, value);
    if (isObject(value) && [value.x, value.y, value.z].every(isFiniteNumber) && Math.hypot(value.x as number, value.y as number, value.z as number) <= EPS) {
      this.fail(path, "must not be a zero vector");
    }
  }
  pose(path: string, value: unknown) {
    if (!isObject(value)) { this.fail(path, "must be a Pose object"); return; }
    this.keys(path, value, ["position", "rotation"]);
    this.point(`${path}.position`, value.position);
    if (value.rotation !== undefined) {
      const q = value.rotation;
      if (!isObject(q)) { this.fail(`${path}.rotation`, "must be a Quaternion object"); return; }
      this.keys(`${path}.rotation`, q, ["w", "x", "y", "z"]);
      const parts = ["x", "y", "z", "w"].map((k) => (q[k] === undefined ? (k === "w" ? 1 : 0) : q[k]));
      if (!parts.every(isFiniteNumber)) { this.fail(`${path}.rotation`, "components must be finite numbers"); return; }
      const norm = Math.hypot(...(parts as number[]));
      if (Math.abs(norm - 1) > 1e-5) this.fail(`${path}.rotation`, `must be a normalized quaternion (norm ${norm})`);
    }
  }
  points(path: string, value: unknown, kind: "polyline3d" | "polygon3d") {
    if (!isObject(value)) { this.fail(path, `must be a ${kind} object`); return [] as Json[]; }
    this.keys(path, value, ["kind", "points"]);
    if (value.kind !== kind) this.fail(`${path}.kind`, `must be "${kind}"`);
    const pts = value.points;
    const min = kind === "polyline3d" ? 2 : 3;
    if (!Array.isArray(pts) || pts.length < min) { this.fail(`${path}.points`, `must be an array of at least ${min} points`); return [] as Json[]; }
    pts.forEach((p, i) => this.point(`${path}.points[${i}]`, p));
    const good = pts.filter((p): p is Json => isObject(p) && [p.x, p.y, p.z].every(isFiniteNumber));
    if (good.length === pts.length) {
      if (kind === "polyline3d") {
        for (let i = 0; i + 1 < good.length; i += 1) {
          if (distance(good[i]!, good[i + 1]!) <= EPS) this.fail(`${path}.points[${i + 1}]`, "repeats the previous point (consecutive duplicates are not allowed)");
        }
      } else if (distance(good[0]!, good[good.length - 1]!) <= EPS) {
        this.fail(`${path}.points`, "repeats the first point; polygon closure is implicit");
      }
    }
    return good;
  }
  geometry(path: string, value: unknown) {
    if (!isObject(value)) { this.fail(path, "must be a Box3D, Polyline3D or Polygon3D"); return; }
    if (value.kind === "box3d") {
      this.keys(path, value, ["kind", "pose", "size"]);
      this.pose(`${path}.pose`, value.pose);
      this.size(`${path}.size`, value.size);
    } else if (value.kind === "polyline3d" || value.kind === "polygon3d") {
      this.points(path, value, value.kind);
    } else {
      this.fail(`${path}.kind`, "must be box3d, polyline3d or polygon3d");
    }
  }
  provenance(path: string, value: unknown) {
    if (value === undefined) return;
    if (!Array.isArray(value)) { this.fail(path, "must be an array of Provenance records"); return; }
    value.forEach((record, i) => {
      const p = `${path}[${i}]`;
      if (!isObject(record)) { this.fail(p, "must be a Provenance object"); return; }
      this.keys(p, record, PROVENANCE_KEYS);
      this.string(`${p}.source_kind`, record.source_kind);
      this.string(`${p}.source_id`, record.source_id);
      if (record.derivation !== undefined && record.derivation !== null && !["observed", "user", "inferred"].includes(record.derivation as string)) {
        this.fail(`${p}.derivation`, `must be "observed", "user", "inferred" or null, got ${JSON.stringify(record.derivation)}`);
      }
      this.number(`${p}.confidence`, record.confidence, { required: false, unit: true });
      if (record.page !== undefined && record.page !== null && !(Number.isInteger(record.page) && (record.page as number) >= 1)) {
        this.fail(`${p}.page`, "must be a 1-based integer");
      }
      if (record.attributes !== undefined && !isObject(record.attributes)) this.fail(`${p}.attributes`, "must be an object");
      for (const field of ["method", "source_element_id"]) {
        if (record[field] !== undefined && record[field] !== null && typeof record[field] !== "string") this.fail(`${p}.${field}`, "must be a string or null");
      }
    });
  }
}

function distance(a: Json, b: Json) {
  return Math.hypot((a.x as number) - (b.x as number), (a.y as number) - (b.y as number), (a.z as number) - (b.z as number));
}

export function parseBuildingModel(input: unknown): ParseResult {
  const c = new Checker();
  if (!isObject(input)) return { ok: false, errors: ["$: a BuildingModel document must be a JSON object"] };
  const doc = input;

  if (doc.schema_version !== CANONICAL_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`$.schema_version: this viewer reads canonical contract ${CANONICAL_SCHEMA_VERSION} only and will not reinterpret ${JSON.stringify(doc.schema_version)}`],
    };
  }
  c.keys("$", doc, TOP_LEVEL);
  c.id("$.model_id", doc.model_id);
  if (doc.name !== undefined && doc.name !== null && typeof doc.name !== "string") c.fail("$.name", "must be a string or null");
  if (doc.attributes !== undefined && !isObject(doc.attributes)) c.fail("$.attributes", "must be an object");
  c.provenance("$.provenance", doc.provenance);

  const cs = doc.coordinate_system;
  if (!isObject(cs)) {
    c.fail("$.coordinate_system", "is required");
  } else {
    c.keys("$.coordinate_system", cs, CS_KEYS);
    c.id("$.coordinate_system.frame_id", cs.frame_id);
    const constants: Record<string, string> = { handedness: "right", up_axis: "+Z", length_unit: "m", angle_unit: "rad" };
    for (const [field, expected] of Object.entries(constants)) {
      if (cs[field] !== expected) c.fail(`$.coordinate_system.${field}`, `must be ${JSON.stringify(expected)}, got ${JSON.stringify(cs[field])}`);
    }
    if (cs.origin_in_crs !== undefined && cs.origin_in_crs !== null) c.point("$.coordinate_system.origin_in_crs", cs.origin_in_crs);
    c.number("$.coordinate_system.true_north_radians", cs.true_north_radians, { required: false, nullable: true });
  }

  // ---- per-entity shape --------------------------------------------------------
  const byId = new Map<string, { collection: string; entity: Json }>();
  const lists: Record<string, Json[]> = {};
  for (const collection of Object.keys(ALLOWED)) {
    const raw = doc[collection];
    if (raw === undefined) { lists[collection] = []; continue; }
    if (!Array.isArray(raw)) { c.fail(`$.${collection}`, "must be an array"); lists[collection] = []; continue; }
    lists[collection] = [];
    raw.forEach((entity, i) => {
      const path = `$.${collection}[${i}]`;
      if (!isObject(entity)) { c.fail(path, "must be an object"); return; }
      lists[collection]!.push(entity);
      c.keys(path, entity, ALLOWED[collection]!);
      c.id(`${path}.id`, entity.id);
      if (typeof entity.id === "string") {
        if (entity.id === doc.model_id) c.fail(`${path}.id`, "collides with model_id");
        if (byId.has(entity.id)) c.fail(`${path}.id`, `duplicate entity id ${JSON.stringify(entity.id)}`);
        else byId.set(entity.id, { collection, entity });
      }
      if (entity.name !== undefined && entity.name !== null && typeof entity.name !== "string") c.fail(`${path}.name`, "must be a string or null");
      c.number(`${path}.confidence`, entity.confidence, { required: false, unit: true });
      if (entity.attributes !== undefined && !isObject(entity.attributes)) c.fail(`${path}.attributes`, "must be an object");
      c.provenance(`${path}.provenance`, entity.provenance);
      checkKind(c, collection, path, entity);
    });
  }

  // ---- reference integrity (oabm/model/model.py validate_model) ---------------
  const ids = (collection: string) => new Set(lists[collection]!.map((e) => e.id as string));
  const levels = ids("levels");
  const spaces = ids("spaces");
  const ports = ids("ports");
  const routes = ids("routes");
  const fittings = ids("route_fittings");
  const circuits = ids("circuits");
  const hostable = new Set([...ids("walls"), ...ids("slabs"), ...ids("ceilings")]);
  const require = (path: string, ref: unknown, set: Set<string> | Map<string, unknown>, what: string) => {
    if (ref === undefined || ref === null) return;
    if (typeof ref === "string" && !set.has(ref)) c.fail(path, `references missing ${what} ${JSON.stringify(ref)}`);
  };
  const each = (collection: string, fn: (entity: Json, path: string) => void) =>
    lists[collection]!.forEach((entity, i) => fn(entity, `$.${collection}[${i}]`));

  for (const collection of ["spaces", "walls", "slabs", "ceilings"]) each(collection, (e, p) => require(`${p}.level_id`, e.level_id, levels, "level"));
  each("openings", (e, p) => require(`${p}.host_id`, e.host_id, hostable, "wall, slab or ceiling"));
  for (const collection of ["electrical_equipment", "electrical_devices"]) {
    each(collection, (e, p) => {
      require(`${p}.level_id`, e.level_id, levels, "level");
      require(`${p}.space_id`, e.space_id, spaces, "space");
      require(`${p}.host_id`, e.host_id, byId, "entity");
    });
  }
  for (const collection of ["obstacles", "route_constraints"]) each(collection, (e, p) => require(`${p}.level_id`, e.level_id, levels, "level"));
  const portById = new Map(lists.ports!.map((p) => [p.id as string, p]));
  each("ports", (e, p) => {
    require(`${p}.owner_id`, e.owner_id, byId, "entity");
    if (e.owner_id === e.id) c.fail(`${p}.owner_id`, "a port cannot own itself");
    const connected = Array.isArray(e.connected_port_ids) ? e.connected_port_ids : [];
    connected.forEach((other, i) => {
      require(`${p}.connected_port_ids[${i}]`, other, ports, "port");
      if (other === e.id) c.fail(`${p}.connected_port_ids[${i}]`, "a port cannot connect to itself");
      const target = portById.get(other as string);
      if (target && !(Array.isArray(target.connected_port_ids) && target.connected_port_ids.includes(e.id))) {
        c.fail(`${p}.connected_port_ids[${i}]`, `port connectivity must be symmetric (${String(e.id)} -> ${String(other)})`);
      }
    });
  });
  const routeById = new Map(lists.routes!.map((r) => [r.id as string, r]));
  const fittingById = new Map(lists.route_fittings!.map((f) => [f.id as string, f]));
  each("routes", (e, p) => {
    require(`${p}.start_port_id`, e.start_port_id, ports, "port");
    require(`${p}.end_port_id`, e.end_port_id, ports, "port");
    const pts = isObject(e.centerline) && Array.isArray(e.centerline.points) ? (e.centerline.points as Json[]) : [];
    const start = portById.get(e.start_port_id as string);
    const end = portById.get(e.end_port_id as string);
    const startPos = start && isObject(start.pose) ? (start.pose.position as Json) : null;
    const endPos = end && isObject(end.pose) ? (end.pose.position as Json) : null;
    if (pts.length >= 2 && startPos && isObject(pts[0]) && distance(pts[0], startPos) > 1e-6) c.fail(`${p}.centerline`, "must start at the start port position");
    if (pts.length >= 2 && endPos && isObject(pts[pts.length - 1]) && distance(pts[pts.length - 1]!, endPos) > 1e-6) c.fail(`${p}.centerline`, "must end at the end port position");
    const fittingIds = Array.isArray(e.fitting_ids) ? e.fitting_ids : [];
    fittingIds.forEach((fid, i) => {
      require(`${p}.fitting_ids[${i}]`, fid, fittings, "route fitting");
      const fitting = fittingById.get(fid as string);
      if (fitting && fitting.route_id !== e.id) c.fail(`${p}.fitting_ids[${i}]`, `${String(fid)}.route_id does not match route ${String(e.id)}`);
    });
  });
  each("route_fittings", (e, p) => {
    require(`${p}.route_id`, e.route_id, routes, "route");
    const route = routeById.get(e.route_id as string);
    if (route && !(Array.isArray(route.fitting_ids) && route.fitting_ids.includes(e.id))) {
      c.fail(`${p}.route_id`, `${String(e.id)} must appear in ${String(e.route_id)}.fitting_ids to preserve fitting order`);
    }
  });
  each("circuits", (e, p) => {
    require(`${p}.source_port_id`, e.source_port_id, ports, "port");
    (Array.isArray(e.load_port_ids) ? e.load_port_ids : []).forEach((id, i) => require(`${p}.load_port_ids[${i}]`, id, ports, "port"));
    (Array.isArray(e.route_ids) ? e.route_ids : []).forEach((id, i) => require(`${p}.route_ids[${i}]`, id, routes, "route"));
  });
  each("conductors", (e, p) => {
    require(`${p}.circuit_id`, e.circuit_id, circuits, "circuit");
    (Array.isArray(e.route_ids) ? e.route_ids : []).forEach((id, i) => require(`${p}.route_ids[${i}]`, id, routes, "route"));
  });

  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, model: doc as unknown as BuildingModel, warnings: c.warnings };
}

function idList(c: Checker, path: string, value: unknown, { required = false, nonEmpty = false } = {}) {
  if (value === undefined) { if (required) c.fail(path, "is required"); return; }
  if (!Array.isArray(value)) { c.fail(path, "must be an array of ids"); return; }
  if (nonEmpty && !value.length) c.fail(path, "must not be empty");
  value.forEach((id, i) => c.id(`${path}[${i}]`, id));
  if (new Set(value).size !== value.length) c.fail(path, "must not repeat an id");
}

function checkKind(c: Checker, collection: string, path: string, e: Json) {
  switch (collection) {
    case "levels":
      c.number(`${path}.elevation_m`, e.elevation_m);
      c.number(`${path}.height_m`, e.height_m, { required: false, nullable: true, positive: true });
      break;
    case "spaces":
      c.id(`${path}.level_id`, e.level_id);
      c.points(`${path}.footprint`, e.footprint, "polygon3d");
      c.number(`${path}.height_m`, e.height_m, { required: false, nullable: true, positive: true });
      if (e.usage !== undefined && e.usage !== null && typeof e.usage !== "string") c.fail(`${path}.usage`, "must be a string or null");
      break;
    case "walls":
      c.id(`${path}.level_id`, e.level_id);
      c.points(`${path}.centerline`, e.centerline, "polyline3d");
      c.number(`${path}.thickness_m`, e.thickness_m, { positive: true });
      c.number(`${path}.height_m`, e.height_m, { positive: true });
      break;
    case "slabs":
      c.id(`${path}.level_id`, e.level_id);
      c.points(`${path}.footprint`, e.footprint, "polygon3d");
      c.number(`${path}.thickness_m`, e.thickness_m, { positive: true });
      break;
    case "ceilings":
      c.id(`${path}.level_id`, e.level_id);
      c.points(`${path}.footprint`, e.footprint, "polygon3d");
      c.number(`${path}.thickness_m`, e.thickness_m, { required: false, nullable: true, positive: true });
      break;
    case "openings":
      c.id(`${path}.host_id`, e.host_id);
      c.string(`${path}.opening_type`, e.opening_type);
      c.pose(`${path}.pose`, e.pose);
      c.size(`${path}.size`, e.size);
      break;
    case "electrical_equipment":
    case "electrical_devices":
      c.string(`${path}.${collection === "electrical_devices" ? "device_type" : "equipment_type"}`, e[collection === "electrical_devices" ? "device_type" : "equipment_type"]);
      c.pose(`${path}.pose`, e.pose);
      if (e.size !== undefined && e.size !== null) c.size(`${path}.size`, e.size);
      for (const ref of ["level_id", "space_id", "host_id"]) c.id(`${path}.${ref}`, e[ref], { required: false, nullable: true });
      c.number(`${path}.rated_voltage_v`, e.rated_voltage_v, { required: false, nullable: true, positive: true });
      break;
    case "ports":
      c.id(`${path}.owner_id`, e.owner_id);
      c.string(`${path}.domain`, e.domain);
      c.string(`${path}.role`, e.role);
      c.pose(`${path}.pose`, e.pose);
      c.vector(`${path}.direction`, e.direction);
      c.number(`${path}.nominal_diameter_m`, e.nominal_diameter_m, { required: false, nullable: true, positive: true });
      idList(c, `${path}.connected_port_ids`, e.connected_port_ids);
      break;
    case "obstacles":
      c.string(`${path}.obstacle_type`, e.obstacle_type, { required: false });
      c.geometry(`${path}.geometry`, e.geometry);
      c.id(`${path}.level_id`, e.level_id, { required: false, nullable: true });
      c.number(`${path}.clearance_m`, e.clearance_m, { required: false, nonNegative: true });
      break;
    case "route_constraints":
      c.string(`${path}.constraint_type`, e.constraint_type);
      c.geometry(`${path}.geometry`, e.geometry);
      c.id(`${path}.level_id`, e.level_id, { required: false, nullable: true });
      c.number(`${path}.clearance_m`, e.clearance_m, { required: false, nonNegative: true });
      if (e.hard !== undefined && typeof e.hard !== "boolean") c.fail(`${path}.hard`, "must be a boolean");
      break;
    case "routes":
      c.string(`${path}.route_type`, e.route_type);
      c.id(`${path}.start_port_id`, e.start_port_id);
      c.id(`${path}.end_port_id`, e.end_port_id);
      c.points(`${path}.centerline`, e.centerline, "polyline3d");
      c.number(`${path}.nominal_diameter_m`, e.nominal_diameter_m, { required: false, nullable: true, positive: true });
      idList(c, `${path}.fitting_ids`, e.fitting_ids);
      break;
    case "route_fittings":
      c.id(`${path}.route_id`, e.route_id);
      c.string(`${path}.fitting_type`, e.fitting_type);
      c.pose(`${path}.pose`, e.pose);
      c.number(`${path}.nominal_diameter_m`, e.nominal_diameter_m, { required: false, nullable: true, positive: true });
      c.number(`${path}.angle_radians`, e.angle_radians, { required: false, nullable: true });
      break;
    case "circuits":
      c.id(`${path}.source_port_id`, e.source_port_id);
      idList(c, `${path}.load_port_ids`, e.load_port_ids, { required: true, nonEmpty: true });
      idList(c, `${path}.route_ids`, e.route_ids);
      c.number(`${path}.voltage_v`, e.voltage_v, { required: false, nullable: true, positive: true });
      c.number(`${path}.load_va`, e.load_va, { required: false, nullable: true, nonNegative: true });
      if (e.poles !== undefined && e.poles !== null && !(Number.isInteger(e.poles) && (e.poles as number) >= 1)) c.fail(`${path}.poles`, "must be an integer of at least 1");
      break;
    case "conductors":
      c.id(`${path}.circuit_id`, e.circuit_id);
      c.string(`${path}.role`, e.role);
      idList(c, `${path}.route_ids`, e.route_ids);
      if (e.count !== undefined && !(Number.isInteger(e.count) && (e.count as number) >= 1)) c.fail(`${path}.count`, "must be an integer of at least 1");
      break;
    default:
      break;
  }
}
