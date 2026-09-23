/*
 * interiorScene.ts -- canonical BuildingModel -> a pure, renderer-free scene
 * description. No React, no WebGL, no DOM: unit tests exercise exactly this.
 *
 * Ported from the E4 viewer (app/scene.js). Every drawable carries:
 *   cls           provenance class, resolved by provenance.ts (fail closed)
 *   basis         where the drawn SHAPE came from:
 *                   canonical-solid     dimensions are canonical fields
 *                   canonical-curve     the curve is a canonical polyline/polygon
 *                   viewer-placeholder  the viewer invented the shape
 *   solidAllowed  false => this element may never be drawn as a filled solid
 *   substitutions every dimension DRAWN differently from the recorded one
 *
 * Enforced invariant (auditInteriorScene, and the tests):
 *   cls === "inferred" || basis === "viewer-placeholder" || substitutions.length
 *     => solidAllowed === false, and such a drawable emits NO triangles.
 *
 * All positions are in the interior model's own canonical frame. Placing that
 * frame on the site is a separate, explicit registration (registration.ts).
 */
import type {
  AnyEntity,
  BuildingModel,
  Circuit,
  ElectricalDevice,
  ElectricalEquipment,
  EntityKind,
  Level,
  Port,
  Provenance,
  Route,
} from "./canonical";
import { COLLECTIONS } from "./canonical";
import {
  DEFAULT_MIN_DRAWN_THICKNESS_M,
  normaliseMinDrawnThickness,
  substituteThickness,
  type ThicknessSubstitution,
} from "./displayThickness";
import {
  add,
  boundsOfPositions,
  boxCorners,
  extrudeFootprint,
  hexaLines,
  hexaTriangles,
  normalize,
  offsetPolyline,
  placeholderMarker,
  polylineLines,
  pt,
  pushSeg,
  scale,
  tubeWire,
  wallSegments,
  type Bounds3,
  type Vec3,
} from "./geometry";
import { CLASSES, INFERRED, classifyEntity, type EntityVerdict, type ProvenanceClass } from "./provenance";

export type LayerId =
  | "structure"
  | "spaces"
  | "openings"
  | "equipment"
  | "devices"
  | "obstacles"
  | "constraints"
  | "routes"
  | "fittings"
  | "conductors"
  | "ports";

export type GeometryBasis = "canonical-solid" | "canonical-curve" | "viewer-placeholder";

export interface LayerSpec { id: LayerId; label: string; customerLabel: string }

/* Two names per category: the canonical/developer one, and what a building
 * owner would call it. The id never changes, so deep links survive relabelling. */
export const LAYERS: readonly LayerSpec[] = [
  { id: "structure", label: "Walls / slabs / ceilings", customerLabel: "Walls, floors & ceilings" },
  { id: "spaces", label: "Space outlines", customerLabel: "Rooms" },
  { id: "openings", label: "Openings", customerLabel: "Doors & windows" },
  { id: "equipment", label: "Electrical equipment", customerLabel: "Panels & equipment" },
  { id: "devices", label: "Electrical devices", customerLabel: "Outlets, switches & fixtures" },
  { id: "obstacles", label: "Obstacles", customerLabel: "Obstructions" },
  { id: "constraints", label: "Route constraints", customerLabel: "Routing rules & keep-outs" },
  { id: "routes", label: "Routes (conduit)", customerLabel: "Conduit" },
  { id: "fittings", label: "Route fittings", customerLabel: "Conduit fittings" },
  { id: "conductors", label: "Conductors (wires)", customerLabel: "Wires" },
  { id: "ports", label: "Ports", customerLabel: "Connection points" },
];

export const KIND_LABEL: Record<EntityKind, string> = {
  level: "Level",
  space: "Space",
  wall: "Wall",
  slab: "Slab",
  ceiling: "Ceiling",
  opening: "Opening",
  electrical_equipment: "Electrical equipment",
  electrical_device: "Electrical device",
  port: "Port",
  obstacle: "Obstacle",
  route_constraint: "Route constraint",
  route: "Route",
  route_fitting: "Route fitting",
  circuit: "Circuit",
  conductor: "Conductor",
};

export const KIND_CUSTOMER: Record<EntityKind, string> = {
  level: "Floor level",
  space: "Room",
  wall: "Wall",
  slab: "Floor",
  ceiling: "Ceiling",
  opening: "Door or window",
  electrical_equipment: "Electrical equipment",
  electrical_device: "Electrical fixture",
  port: "Connection point",
  obstacle: "Obstruction",
  route_constraint: "Routing rule",
  route: "Conduit run",
  route_fitting: "Conduit fitting",
  circuit: "Circuit",
  conductor: "Wire",
};

export interface Prim {
  type: "triangles" | "lines";
  positions: number[];
  /**
   * "detail" marks line work that only means something when it is several
   * pixels wide on screen (a conduit's diameter cage, the wires inside it).
   * The renderer may leave it out when it would collapse onto the dashed
   * centerline and fill its gaps -- which would make inferred look solid.
   */
  role?: "detail";
}

export interface Drawable {
  key: string;
  entityId: string;
  entityKind: EntityKind;
  kindLabel: string;
  kindCustomer: string;
  displayName: string;
  name: string | null;
  layer: LayerId;
  cls: ProvenanceClass;
  verdict: EntityVerdict;
  basis: GeometryBasis;
  basisNote: string;
  solidAllowed: boolean;
  substitutions: ThicknessSubstitution[];
  prims: Prim[];
  bounds: Bounds3;
  center: Vec3;
  entity: AnyEntity;
  circuitIds: string[];
  levelId: string | null;
  levelBasis: string;
  /** Where to hang a text label (room names), in the canonical frame. */
  labelAnchor: Vec3 | null;
}

export interface SceneWarning { kind: string; entityId: string | null; diagnostic: string }

export interface SceneLevel {
  id: string;
  name: string;
  elevation_m: number;
  height_m: number | null;
  drawableKeys: string[];
  verdict: EntityVerdict;
}

export interface SceneCircuit {
  id: string;
  name: string;
  number: string | null;
  voltage_v: number | null;
  memberKeys: string[];
  sourceKeys: string[];
  loadKeys: string[];
  routeKeys: string[];
  conductorIds: string[];
  entity: Circuit;
  verdict: EntityVerdict;
}

export interface SceneMeta {
  /** The rendering parameters that produced this scene. Shown, never silent. */
  displaySettings: { minDrawnThickness_m: number };
  substitutionCount: number;
  substitutedKeys: string[];
  modelId: string;
  name: string;
  frameId: string;
  /** The model says it describes no real building (designed/synthetic sample). */
  synthetic: boolean;
  notice: string | null;
  modelProvenance: Provenance[];
  classCounts: Record<ProvenanceClass, number>;
  entityCounts: Record<string, number>;
  bounds: Bounds3;
  /** Georeference the model itself declares. Reported, never used to place it. */
  declaredGeoreference: { crs: string | null; hasOrigin: boolean; trueNorthRadians: number | null };
}

export interface InteriorScene {
  meta: SceneMeta;
  layers: Array<LayerSpec & { count: number }>;
  levels: SceneLevel[];
  unlevelledKeys: string[];
  drawables: Drawable[];
  byKey: Record<string, Drawable>;
  circuits: SceneCircuit[];
  warnings: SceneWarning[];
}

export interface BuildOptions { minDrawnThickness_m?: number }

/* A name containing a scheme:token or a long hex run is an identifier, not a
 * human name (the RoomPlan importer names spaces "RoomPlan room real:scan-..."). */
const ID_LIKE = /[a-z][a-z0-9_-]*:[A-Za-z0-9_.-]{4,}|[0-9a-f]{12,}/i;
const TYPE_FIELDS = ["device_type", "equipment_type", "opening_type", "route_type", "fitting_type", "obstacle_type", "constraint_type", "usage", "role"];

export function looksLikeIdentifier(value: string) {
  return ID_LIKE.test(value);
}

export function titleCase(value: string) {
  return String(value).replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** A human-readable name. Never invents one and never falls back to the id. */
export function displayName(entity: AnyEntity, kind: EntityKind) {
  if (typeof entity.name === "string" && entity.name.trim() && !looksLikeIdentifier(entity.name)) return entity.name.trim();
  for (const field of TYPE_FIELDS) {
    const value = entity[field];
    if (typeof value === "string" && value.trim()) return titleCase(value);
  }
  return KIND_CUSTOMER[kind] ?? KIND_LABEL[kind] ?? kind;
}

interface EmitSpec {
  entity: AnyEntity;
  kind: EntityKind;
  layer: LayerId;
  basis: GeometryBasis;
  basisNote: string;
  prims: Prim[];
  substitutions?: ThicknessSubstitution[];
  labelAnchor?: Vec3 | null;
}

class Builder {
  drawables: Drawable[] = [];
  warnings: SceneWarning[] = [];
  bounds: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  /* The class is resolved here and the solid rule is enforced here, so no call
   * site can accidentally emit a filled mesh for inferred or invented geometry. */
  emit(spec: EmitSpec): Drawable | null {
    const verdict = classifyEntity(spec.kind, spec.entity);
    const substitutions = spec.substitutions ?? [];
    const solidAllowed = verdict.cls !== INFERRED && spec.basis !== "viewer-placeholder" && substitutions.length === 0;
    const prims: Prim[] = [];
    for (const prim of spec.prims) {
      if (!prim.positions.length) continue;
      if (prim.type === "triangles" && !solidAllowed) {
        this.warnings.push({
          kind: "assumed-shape",
          entityId: spec.entity.id,
          diagnostic: `dropped a solid primitive for ${spec.entity.id} (${verdict.cls}/${spec.basis}${substitutions.length ? "/drawn-thickness" : ""})`,
        });
        continue;
      }
      prims.push(prim);
    }
    if (!prims.length) return null;
    const bounds: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const prim of prims) {
      boundsOfPositions(prim.positions, bounds);
      boundsOfPositions(prim.positions, this.bounds);
    }
    const drawable: Drawable = {
      key: spec.entity.id,
      entityId: spec.entity.id,
      entityKind: spec.kind,
      kindLabel: KIND_LABEL[spec.kind],
      kindCustomer: KIND_CUSTOMER[spec.kind],
      displayName: displayName(spec.entity, spec.kind),
      name: typeof spec.entity.name === "string" ? spec.entity.name : null,
      layer: spec.layer,
      cls: verdict.cls,
      verdict,
      basis: spec.basis,
      basisNote: spec.basisNote,
      solidAllowed,
      substitutions,
      prims,
      bounds,
      center: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2],
      entity: spec.entity,
      circuitIds: [],
      levelId: null,
      levelBasis: "",
      labelAnchor: spec.labelAnchor ?? null,
    };
    this.drawables.push(drawable);
    return drawable;
  }
}

function ringOf(points: { x: number; y: number; z: number }[]): Vec3[] {
  return points.map(pt);
}

function centroidXY(ring: Vec3[]): Vec3 {
  const n = ring.length || 1;
  const sum = ring.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export function buildInteriorScene(model: BuildingModel, options: BuildOptions = {}): InteriorScene {
  const minDrawn = options.minDrawnThickness_m === undefined
    ? DEFAULT_MIN_DRAWN_THICKNESS_M
    : normaliseMinDrawnThickness(options.minDrawnThickness_m);
  const b = new Builder();
  const portById = new Map<string, Port>((model.ports ?? []).map((p) => [p.id, p]));
  const routeById = new Map<string, Route>((model.routes ?? []).map((r) => [r.id, r]));
  const asAny = (e: unknown) => e as AnyEntity;

  // ---- walls ---------------------------------------------------------------
  for (const wall of model.walls ?? []) {
    const path = wall.centerline.points.map(pt);
    const swap = substituteThickness("wall", wall.thickness_m, minDrawn);
    const drawn = swap ? swap.drawn_m : wall.thickness_m;
    b.emit({
      entity: asAny(wall), kind: "wall", layer: "structure", basis: "canonical-solid",
      basisNote: swap
        ? `extruded from the canonical centerline and height_m, but DRAWN ${swap.drawn_m} m thick instead of the recorded ${swap.recorded_m} m, because a wall that thin cannot be seen. The drawn thickness is a rendering choice, not a measurement; the model still records ${swap.recorded_m} m.`
        : "solid extruded from canonical centerline + thickness_m + height_m",
      substitutions: swap ? [swap] : [],
      prims: [
        { type: "triangles", positions: wallSegments(path, drawn, wall.height_m, false) },
        { type: "lines", positions: wallSegments(path, drawn, wall.height_m, true) },
      ],
    });
  }

  // ---- slabs ---------------------------------------------------------------
  for (const slab of model.slabs ?? []) {
    const ring = ringOf(slab.footprint.points);
    const z = ring[0]![2];
    const outline = polylineLines(ring.map((p): Vec3 => [p[0], p[1], z]), true);
    const swap = substituteThickness("slab", slab.thickness_m, minDrawn);
    const thickness = swap ? swap.drawn_m : slab.thickness_m;
    const solid = extrudeFootprint(ring, z - thickness, z);
    if (solid) {
      b.emit({
        entity: asAny(slab), kind: "slab", layer: "structure", basis: "canonical-solid",
        basisNote: swap
          ? `prism from the canonical footprint, DRAWN ${swap.drawn_m} m thick instead of the recorded ${swap.recorded_m} m so it is visible; a rendering choice, not a measurement`
          : "prism from canonical footprint + thickness_m (top face at the footprint elevation)",
        substitutions: swap ? [swap] : [],
        prims: [{ type: "triangles", positions: solid }, { type: "lines", positions: outline }],
      });
    } else {
      b.warnings.push({ kind: "assumed-shape", entityId: slab.id, diagnostic: `slab ${slab.id} footprint self-intersects; drawn as an outline only` });
      b.emit({
        entity: asAny(slab), kind: "slab", layer: "structure", basis: "canonical-curve",
        basisNote: "the footprint crosses itself, so it has no single interior; only the canonical outline is drawn",
        prims: [{ type: "lines", positions: outline }],
      });
    }
  }

  // ---- ceilings ------------------------------------------------------------
  for (const ceiling of model.ceilings ?? []) {
    const ring = ringOf(ceiling.footprint.points);
    const z = ring[0]![2];
    const outline = polylineLines(ring, true);
    const hasThickness = typeof ceiling.thickness_m === "number" && ceiling.thickness_m > 0;
    const swap = hasThickness ? substituteThickness("ceiling", ceiling.thickness_m, minDrawn) : null;
    const thickness = swap ? swap.drawn_m : (ceiling.thickness_m ?? 0);
    const solid = hasThickness ? extrudeFootprint(ring, z, z + thickness) : null;
    if (solid) {
      b.emit({
        entity: asAny(ceiling), kind: "ceiling", layer: "structure", basis: "canonical-solid",
        basisNote: swap
          ? `prism from the canonical footprint, DRAWN ${swap.drawn_m} m thick instead of the recorded ${swap.recorded_m} m so it is visible; a rendering choice, not a measurement`
          : "prism from canonical footprint + thickness_m (bottom face at the footprint elevation)",
        substitutions: swap ? [swap] : [],
        prims: [{ type: "triangles", positions: solid }, { type: "lines", positions: outline }],
      });
    } else {
      b.emit({
        entity: asAny(ceiling), kind: "ceiling", layer: "structure", basis: "canonical-curve",
        basisNote: hasThickness
          ? "the footprint crosses itself, so it has no single interior; only the canonical outline is drawn"
          : "thickness_m is null in the model, so only the canonical footprint is drawn and no thickness is invented",
        prims: [{ type: "lines", positions: outline }],
      });
    }
  }

  // ---- spaces --------------------------------------------------------------
  for (const space of model.spaces ?? []) {
    const ring = ringOf(space.footprint.points);
    const out = polylineLines(ring, true);
    if (space.height_m) {
      const top = ring.map((p): Vec3 => [p[0], p[1], p[2] + space.height_m!]);
      polylineLines(top, true, out);
      ring.forEach((p, k) => pushSeg(out, p, top[k]!));
    }
    const c = centroidXY(ring);
    b.emit({
      entity: asAny(space), kind: "space", layer: "spaces", basis: "canonical-curve",
      basisNote: `canonical footprint polygon${space.height_m ? " swept to canonical height_m as an outline" : ""}`,
      prims: [{ type: "lines", positions: out }],
      labelAnchor: [c[0], c[1], c[2] + 0.05],
    });
  }

  // ---- openings ------------------------------------------------------------
  for (const opening of model.openings ?? []) {
    const corners = boxCorners(pt(opening.pose.position), opening.size, opening.pose.rotation);
    b.emit({
      entity: asAny(opening), kind: "opening", layer: "openings", basis: "canonical-solid",
      basisNote: "box from canonical pose + size; drawn as a see-through void body, not as building matter",
      prims: [{ type: "triangles", positions: hexaTriangles(corners) }, { type: "lines", positions: hexaLines(corners) }],
    });
  }

  // ---- equipment and devices ----------------------------------------------
  const emitPlaced = (entity: ElectricalEquipment | ElectricalDevice, kind: EntityKind, layer: LayerId) => {
    const center = pt(entity.pose.position);
    if (entity.size) {
      const corners = boxCorners(center, entity.size, entity.pose.rotation);
      b.emit({
        entity: asAny(entity), kind, layer, basis: "canonical-solid", basisNote: "box from canonical pose + size",
        prims: [{ type: "triangles", positions: hexaTriangles(corners) }, { type: "lines", positions: hexaLines(corners) }],
      });
    } else {
      b.emit({
        entity: asAny(entity), kind, layer, basis: "viewer-placeholder",
        basisNote: "the model carries NO size for this element; the marker is a viewer placeholder at the canonical pose, not a measured shape",
        prims: [{ type: "lines", positions: placeholderMarker(center, 0.24) }],
      });
    }
  };
  for (const e of model.electrical_equipment ?? []) emitPlaced(e, "electrical_equipment", "equipment");
  for (const e of model.electrical_devices ?? []) emitPlaced(e, "electrical_device", "devices");

  // ---- obstacles -----------------------------------------------------------
  for (const obstacle of model.obstacles ?? []) {
    const g = obstacle.geometry;
    if (g.kind === "box3d") {
      const corners = boxCorners(pt(g.pose.position), g.size, g.pose.rotation);
      b.emit({
        entity: asAny(obstacle), kind: "obstacle", layer: "obstacles", basis: "canonical-solid", basisNote: "box from canonical Box3D geometry",
        prims: [{ type: "triangles", positions: hexaTriangles(corners) }, { type: "lines", positions: hexaLines(corners) }],
      });
    } else {
      b.emit({
        entity: asAny(obstacle), kind: "obstacle", layer: "obstacles", basis: "canonical-curve", basisNote: `canonical ${g.kind} geometry`,
        prims: [{ type: "lines", positions: polylineLines(g.points.map(pt), g.kind === "polygon3d") }],
      });
    }
  }

  // ---- route constraints (a rule, not matter: never filled) -----------------
  for (const constraint of model.route_constraints ?? []) {
    const g = constraint.geometry;
    const positions = g.kind === "box3d"
      ? hexaLines(boxCorners(pt(g.pose.position), g.size, g.pose.rotation))
      : polylineLines(g.points.map(pt), g.kind === "polygon3d");
    b.emit({
      entity: asAny(constraint), kind: "route_constraint", layer: "constraints", basis: "canonical-curve",
      basisNote: `canonical ${g.kind} geometry of a routing rule, drawn as an outline because a rule is not building matter`,
      prims: [{ type: "lines", positions }],
    });
  }

  // ---- routes --------------------------------------------------------------
  for (const route of model.routes ?? []) {
    const path = route.centerline.points.map(pt);
    const prims: Prim[] = [{ type: "lines", positions: polylineLines(path, false) }];
    let note: string;
    if (route.nominal_diameter_m) {
      prims.push({ type: "lines", positions: tubeWire(path, route.nominal_diameter_m / 2, 8), role: "detail" });
      note = "canonical centerline, plus a wire cage at canonical nominal_diameter_m when zoomed in close enough to see it: a routed path is inferred, so it is never shown as a solid tube";
    } else {
      note = "canonical centerline only; nominal_diameter_m is null so no diameter is invented";
    }
    b.emit({ entity: asAny(route), kind: "route", layer: "routes", basis: "canonical-curve", basisNote: note, prims });
  }

  // ---- fittings ------------------------------------------------------------
  for (const fitting of model.route_fittings ?? []) {
    const size = (fitting.nominal_diameter_m || 0.02) * 4;
    b.emit({
      entity: asAny(fitting), kind: "route_fitting", layer: "fittings", basis: "viewer-placeholder",
      basisNote: "the model gives a fitting a pose and a type but no body; this marker is a viewer placeholder",
      prims: [{ type: "lines", positions: placeholderMarker(pt(fitting.pose.position), size) }],
    });
  }

  // ---- ports ---------------------------------------------------------------
  for (const port of model.ports ?? []) {
    const center = pt(port.pose.position);
    const positions = placeholderMarker(center, 0.12);
    const dir = normalize([port.direction.x, port.direction.y, port.direction.z]);
    pushSeg(positions, center, add(center, scale(dir, 0.18)));
    b.emit({
      entity: asAny(port), kind: "port", layer: "ports", basis: "viewer-placeholder",
      basisNote: "a port has a canonical pose and direction but no size; the marker and the direction stub are viewer placeholders",
      prims: [{ type: "lines", positions }],
    });
  }

  // ---- conductors ----------------------------------------------------------
  const strandSlots = new Map<string, number>();
  for (const conductor of model.conductors ?? []) {
    for (const routeId of conductor.route_ids ?? []) strandSlots.set(routeId, (strandSlots.get(routeId) ?? 0) + (conductor.count || 1));
  }
  const strandUsed = new Map<string, number>();
  for (const conductor of model.conductors ?? []) {
    const positions: number[] = [];
    let drew = 0;
    for (const routeId of conductor.route_ids ?? []) {
      const route = routeById.get(routeId);
      if (!route) {
        b.warnings.push({ kind: "dangling-reference", entityId: conductor.id, diagnostic: `conductor ${conductor.id} references missing route ${routeId}` });
        continue;
      }
      const path = route.centerline.points.map(pt);
      const radius = (route.nominal_diameter_m ? route.nominal_diameter_m / 2 : 0.012) * 0.45;
      const total = Math.max(1, strandSlots.get(routeId) ?? 1);
      for (let s = 0; s < (conductor.count || 1); s += 1) {
        const slot = strandUsed.get(routeId) ?? 0;
        strandUsed.set(routeId, slot + 1);
        polylineLines(offsetPolyline(path, radius, (2 * Math.PI * slot) / total), false, positions);
        drew += 1;
      }
    }
    if (!drew) continue;
    b.emit({
      entity: asAny(conductor), kind: "conductor", layer: "conductors", basis: "viewer-placeholder",
      basisNote: "conductors have NO geometry in the canonical model; these strands are viewer placeholders offset inside the inferred route centerline, drawn only when the conduit is wide enough on screen to hold them",
      prims: [{ type: "lines", positions, role: "detail" }],
    });
  }

  // ---- level resolution ----------------------------------------------------
  /* Which storey is an element on? Resolved by FOLLOWING CANONICAL REFERENCES
   * only -- level_id, space_id, host_id, owner_id, route_id, start/end port,
   * route_ids[0] -- and never by comparing elevations: a conduit riser that
   * crosses a floor has no single elevation, and a mezzanine would silently
   * absorb the floor below. An element whose chain reaches no level has none,
   * and the overlay says how many such elements there are. */
  const entityById = new Map<string, AnyEntity>();
  for (const collection of COLLECTIONS) {
    for (const entity of (model[collection] ?? []) as unknown as AnyEntity[]) {
      if (entity?.id && !entityById.has(entity.id)) entityById.set(entity.id, entity);
    }
  }
  const levelById = new Map<string, Level>((model.levels ?? []).map((l) => [l.id, l]));
  const LEVEL_REFS = ["space_id", "host_id", "owner_id", "route_id", "start_port_id", "end_port_id"];
  const resolveLevel = (entity: AnyEntity | undefined, depth: number, trail: string[], seen: Set<string>): { levelId: string; basis: string } | null => {
    if (!entity || depth > 8 || seen.has(entity.id)) return null;
    seen.add(entity.id);
    const levelId = entity.level_id;
    if (typeof levelId === "string" && levelId) {
      if (levelById.has(levelId)) return { levelId, basis: [...trail, "level_id"].join(" -> ") };
      b.warnings.push({ kind: "dangling-level", entityId: entity.id, diagnostic: `${entity.id} states level_id ${levelId} but the model has no such level` });
    }
    const refs: Array<[string, string]> = [];
    for (const field of LEVEL_REFS) {
      const value = entity[field];
      if (typeof value === "string" && value) refs.push([field, value]);
    }
    const routeIds = entity.route_ids;
    if (Array.isArray(routeIds) && typeof routeIds[0] === "string") refs.push(["route_ids[0]", routeIds[0]]);
    for (const [field, id] of refs) {
      const got = resolveLevel(entityById.get(id), depth + 1, [...trail, field], seen);
      if (got) return got;
    }
    return null;
  };
  const unlevelled: string[] = [];
  for (const d of b.drawables) {
    const got = resolveLevel(d.entity, 0, [], new Set());
    d.levelId = got ? got.levelId : null;
    d.levelBasis = got ? got.basis : "no reference chain from this element reaches a Level";
    if (!got) unlevelled.push(d.key);
  }

  const levels: SceneLevel[] = (model.levels ?? []).map((l, index) => ({
    id: l.id,
    name: l.name || `Level ${index + 1}`,
    elevation_m: l.elevation_m,
    height_m: typeof l.height_m === "number" ? l.height_m : null,
    drawableKeys: b.drawables.filter((d) => d.levelId === l.id).map((d) => d.key),
    verdict: classifyEntity("level", l),
  })).sort((a, c) => (a.elevation_m - c.elevation_m) || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));

  // ---- circuit membership --------------------------------------------------
  const byKey: Record<string, Drawable> = {};
  const byEntity = new Map<string, Drawable[]>();
  for (const d of b.drawables) {
    byKey[d.key] = d;
    byEntity.set(d.entityId, [...(byEntity.get(d.entityId) ?? []), d]);
  }
  const circuits: SceneCircuit[] = (model.circuits ?? []).map((circuit) => {
    const memberKeys: string[] = [];
    const sourceKeys: string[] = [];
    const loadKeys: string[] = [];
    const routeKeys: string[] = [];
    const conductorIds: string[] = [];
    const addFor = (entityId: string | undefined, bucket: string[]) => {
      if (!entityId) return;
      for (const d of byEntity.get(entityId) ?? []) {
        bucket.push(d.key);
        memberKeys.push(d.key);
        if (!d.circuitIds.includes(circuit.id)) d.circuitIds.push(circuit.id);
      }
    };
    addFor(circuit.source_port_id, sourceKeys);
    addFor(portById.get(circuit.source_port_id)?.owner_id, sourceKeys);
    for (const pid of circuit.load_port_ids ?? []) {
      addFor(pid, loadKeys);
      addFor(portById.get(pid)?.owner_id, loadKeys);
    }
    for (const rid of circuit.route_ids ?? []) {
      addFor(rid, routeKeys);
      for (const fid of routeById.get(rid)?.fitting_ids ?? []) addFor(fid, routeKeys);
    }
    for (const conductor of model.conductors ?? []) {
      if (conductor.circuit_id === circuit.id) {
        conductorIds.push(conductor.id);
        addFor(conductor.id, routeKeys);
      }
    }
    return {
      id: circuit.id,
      name: circuit.name && !looksLikeIdentifier(circuit.name) ? circuit.name : `Circuit ${circuit.circuit_number ?? ""}`.trim(),
      number: circuit.circuit_number ?? null,
      voltage_v: circuit.voltage_v ?? null,
      memberKeys: [...new Set(memberKeys)],
      sourceKeys,
      loadKeys,
      routeKeys,
      conductorIds,
      entity: circuit,
      verdict: classifyEntity("circuit", circuit),
    };
  });

  // ---- meta ----------------------------------------------------------------
  const classCounts: Record<ProvenanceClass, number> = { observed: 0, user: 0, inferred: 0 };
  for (const d of b.drawables) classCounts[d.cls] += 1;
  const attrs = (model.attributes ?? {}) as Record<string, unknown>;
  const substituted = b.drawables.filter((d) => d.substitutions.length);
  const entityCounts: Record<string, number> = {};
  for (const collection of COLLECTIONS) {
    const list = model[collection];
    if (Array.isArray(list)) entityCounts[collection] = list.length;
  }
  const finite = Number.isFinite(b.bounds.min[0]);
  const cs = model.coordinate_system;

  return {
    meta: {
      displaySettings: { minDrawnThickness_m: minDrawn },
      substitutionCount: substituted.length,
      substitutedKeys: substituted.map((d) => d.key),
      modelId: model.model_id,
      name: model.name || model.model_id,
      frameId: cs.frame_id,
      synthetic: attrs.synthetic === true || attrs.designed_sample === true || attrs.surveyed_building === false,
      notice: typeof attrs.notice === "string" ? attrs.notice : null,
      modelProvenance: model.provenance ?? [],
      classCounts,
      entityCounts,
      bounds: finite ? b.bounds : { min: [0, 0, 0], max: [1, 1, 1] },
      declaredGeoreference: {
        crs: cs.crs ?? null,
        hasOrigin: Boolean(cs.origin_in_crs),
        trueNorthRadians: typeof cs.true_north_radians === "number" ? cs.true_north_radians : null,
      },
    },
    layers: LAYERS.map((layer) => ({ ...layer, count: b.drawables.filter((d) => d.layer === layer.id).length })),
    levels,
    unlevelledKeys: unlevelled,
    drawables: b.drawables,
    byKey,
    circuits,
    warnings: b.warnings,
  };
}

/** The render-safety invariant. Returns one string per violation. */
export function auditInteriorScene(scene: InteriorScene): string[] {
  const problems: string[] = [];
  for (const d of scene.drawables) {
    if (!CLASSES.includes(d.cls)) problems.push(`${d.key}: class ${JSON.stringify(d.cls)} is not one of the three required classes`);
    if (!d.verdict.reasons.length) problems.push(`${d.key}: carries no stated reason for its provenance class`);
    const mustNotBeSolid = d.cls === INFERRED || d.basis === "viewer-placeholder" || d.substitutions.length > 0;
    if (mustNotBeSolid && d.solidAllowed) problems.push(`${d.key}: inferred/placeholder/drawn-thickness geometry is marked solid-allowed`);
    if (mustNotBeSolid && d.prims.some((p) => p.type === "triangles")) problems.push(`${d.key}: inferred/placeholder/drawn-thickness geometry emitted a filled primitive`);
    if (!d.prims.length) problems.push(`${d.key}: no primitives`);
  }
  return problems;
}
