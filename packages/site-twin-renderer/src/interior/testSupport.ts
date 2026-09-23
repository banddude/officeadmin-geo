/*
 * testSupport.ts -- tiny, obviously made-up canonical documents for unit tests.
 * Not imported by any runtime code.
 */
import type { BuildingModel, Derivation, Provenance } from "./canonical";

export function record(derivation: Derivation | null | undefined, extra: Partial<Provenance> = {}): Provenance {
  const base: Provenance = { source_kind: "test", source_id: "test:fixture", method: `test record (${String(derivation)})` };
  if (derivation !== undefined) base.derivation = derivation;
  return { ...base, ...extra };
}

/** A one-room, one-level model: 4 x 3 m, walls 0.2 m thick, 2.7 m tall. */
export function tinyModel(overrides: Partial<BuildingModel> = {}): BuildingModel {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({
    id, level_id: "level:1", thickness_m: 0.2, height_m: 2.7, provenance: [record("observed")],
    centerline: { kind: "polyline3d" as const, points: [{ x: ax, y: ay, z: 0 }, { x: bx, y: by, z: 0 }] },
  });
  return {
    model_id: "test:tiny",
    schema_version: "1.0.0",
    coordinate_system: { frame_id: "test-frame", handedness: "right", up_axis: "+Z", length_unit: "m", angle_unit: "rad" },
    levels: [{ id: "level:1", name: "Test level", elevation_m: 0, height_m: 2.7, provenance: [record("user")] }],
    walls: [wall("wall:s", 0, 0, 4, 0), wall("wall:e", 4, 0, 4, 3), wall("wall:n", 4, 3, 0, 3), wall("wall:w", 0, 3, 0, 0)],
    ...overrides,
  };
}

/** tinyModel plus a panel, one receptacle, their ports and one route between them. */
export function tinyElectricalModel(): BuildingModel {
  return clone(tinyModel({
    electrical_equipment: [{
      id: "equipment:panel", equipment_type: "panelboard", level_id: "level:1", host_id: "wall:w",
      pose: { position: { x: 0.1, y: 1.5, z: 1.5 } }, size: { x: 0.1, y: 0.5, z: 0.8 }, provenance: [record("observed")],
    }],
    electrical_devices: [{
      id: "device:r", device_type: "receptacle", level_id: "level:1", host_id: "wall:s",
      pose: { position: { x: 2, y: 0.1, z: 0.4 } }, size: { x: 0.08, y: 0.05, z: 0.12 }, provenance: [record("user")],
    }],
    ports: [
      { id: "port:panel", owner_id: "equipment:panel", domain: "power", role: "source", pose: { position: { x: 0.1, y: 1.5, z: 1.9 } }, direction: { x: 0, y: 0, z: 1 }, provenance: inferred },
      { id: "port:r", owner_id: "device:r", domain: "power", role: "load", pose: { position: { x: 2, y: 0.1, z: 0.46 } }, direction: { x: 0, y: 0, z: 1 }, provenance: inferred },
    ],
    routes: [{
      id: "route:1", route_type: "emt", start_port_id: "port:panel", end_port_id: "port:r", nominal_diameter_m: 0.02, fitting_ids: ["fitting:1"], provenance: inferred,
      centerline: { kind: "polyline3d", points: [{ x: 0.1, y: 1.5, z: 1.9 }, { x: 0.1, y: 1.5, z: 2.5 }, { x: 2, y: 1.5, z: 2.5 }, { x: 2, y: 0.1, z: 2.5 }, { x: 2, y: 0.1, z: 0.46 }] },
    }],
    route_fittings: [{ id: "fitting:1", route_id: "route:1", fitting_type: "elbow-90", pose: { position: { x: 0.1, y: 1.5, z: 2.5 } }, provenance: inferred }],
    circuits: [{ id: "circuit:1", source_port_id: "port:panel", load_port_ids: ["port:r"], route_ids: ["route:1"], provenance: [record("user")] }],
    conductors: [{ id: "conductor:1", circuit_id: "circuit:1", role: "line", route_ids: ["route:1"], provenance: inferred }],
  }));
}

const inferred = [record("inferred")];

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
