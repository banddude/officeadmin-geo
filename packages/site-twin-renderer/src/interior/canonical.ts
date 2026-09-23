/*
 * canonical.ts -- TypeScript shapes for the canonical OfficeAdmin BuildingModel
 * (contract v1, `oabm-model-v1.schema.json` in officeadmin-building-model).
 *
 * This file declares the contract as a consumer sees it. It invents nothing:
 * every field name, unit and optionality below is the schema's. Linear values
 * are metres, angles are radians, coordinates are right-handed with +Z up and
 * XY as the plan plane, all in the document's own `coordinate_system.frame_id`.
 *
 * Site Twin is a CONSUMER of this model. It never writes a BuildingModel back,
 * and nothing drawn here (a display thickness, a registration, a cut plane) is
 * ever a field of one.
 */

export const CANONICAL_SCHEMA_VERSION = "1.0.0" as const;

export type Derivation = "observed" | "user" | "inferred";

export interface Point3 { x: number; y: number; z: number }
export interface Vector3 { x: number; y: number; z: number }
export interface Size3 { x: number; y: number; z: number }
export interface Quaternion { w?: number; x?: number; y?: number; z?: number }
export interface Pose { position: Point3; rotation?: Quaternion }

export interface Polyline3D { kind: "polyline3d"; points: Point3[] }
export interface Polygon3D { kind: "polygon3d"; points: Point3[] }
export interface Box3D { kind: "box3d"; pose: Pose; size: Size3 }
export type Geometry3D = Box3D | Polyline3D | Polygon3D;

export interface Provenance {
  source_kind: string;
  source_id: string;
  source_element_id?: string | null;
  page?: number | null;
  method?: string | null;
  confidence?: number;
  /** How the element came to exist. Unset is NOT a claim of observation. */
  derivation?: Derivation | null;
  attributes?: Record<string, unknown>;
}

export interface CoordinateSystem {
  frame_id: string;
  handedness: "right";
  up_axis: "+Z";
  length_unit: "m";
  angle_unit: "rad";
  crs?: string | null;
  origin_in_crs?: Point3 | null;
  true_north_radians?: number | null;
}

interface EntityBase {
  id: string;
  name?: string | null;
  confidence?: number;
  provenance?: Provenance[];
  attributes?: Record<string, unknown>;
}

export interface Level extends EntityBase { elevation_m: number; height_m?: number | null }
export interface Space extends EntityBase { level_id: string; footprint: Polygon3D; height_m?: number | null; usage?: string | null }
export interface Wall extends EntityBase { level_id: string; centerline: Polyline3D; thickness_m: number; height_m: number }
export interface Slab extends EntityBase { level_id: string; footprint: Polygon3D; thickness_m: number }
export interface Ceiling extends EntityBase { level_id: string; footprint: Polygon3D; thickness_m?: number | null }
export interface Opening extends EntityBase { host_id: string; opening_type: string; pose: Pose; size: Size3 }

interface PlacedElectrical extends EntityBase {
  pose: Pose;
  size?: Size3 | null;
  level_id?: string | null;
  space_id?: string | null;
  host_id?: string | null;
  rated_voltage_v?: number | null;
  system?: string | null;
}
export interface ElectricalEquipment extends PlacedElectrical { equipment_type: string }
export interface ElectricalDevice extends PlacedElectrical { device_type: string }

export interface Port extends EntityBase {
  owner_id: string;
  domain: string;
  role: string;
  pose: Pose;
  direction: Vector3;
  nominal_diameter_m?: number | null;
  connected_port_ids?: string[];
}

export interface Obstacle extends EntityBase {
  obstacle_type: string;
  geometry: Geometry3D;
  level_id?: string | null;
  clearance_m?: number;
}

export interface RouteConstraint extends EntityBase {
  constraint_type: string;
  geometry: Geometry3D;
  level_id?: string | null;
  hard?: boolean;
  clearance_m?: number;
  applies_to?: string[];
}

export interface Route extends EntityBase {
  route_type: string;
  start_port_id: string;
  end_port_id: string;
  centerline: Polyline3D;
  nominal_diameter_m?: number | null;
  fitting_ids?: string[];
}

export interface RouteFitting extends EntityBase {
  route_id: string;
  fitting_type: string;
  pose: Pose;
  nominal_diameter_m?: number | null;
  angle_radians?: number | null;
}

export interface Circuit extends EntityBase {
  source_port_id: string;
  load_port_ids: string[];
  route_ids?: string[];
  circuit_number?: string | null;
  voltage_v?: number | null;
  poles?: number | null;
  phase?: string | null;
  load_va?: number | null;
}

export interface Conductor extends EntityBase {
  circuit_id: string;
  role: string;
  route_ids?: string[];
  material?: string | null;
  size?: string | null;
  count?: number;
  insulation?: string | null;
}

export interface BuildingModel {
  model_id: string;
  schema_version: typeof CANONICAL_SCHEMA_VERSION;
  coordinate_system: CoordinateSystem;
  name?: string | null;
  provenance?: Provenance[];
  attributes?: Record<string, unknown>;
  levels?: Level[];
  spaces?: Space[];
  walls?: Wall[];
  slabs?: Slab[];
  ceilings?: Ceiling[];
  openings?: Opening[];
  electrical_equipment?: ElectricalEquipment[];
  electrical_devices?: ElectricalDevice[];
  ports?: Port[];
  obstacles?: Obstacle[];
  route_constraints?: RouteConstraint[];
  routes?: Route[];
  route_fittings?: RouteFitting[];
  circuits?: Circuit[];
  conductors?: Conductor[];
}

/** Canonical entity kinds, in the vocabulary the viewer uses everywhere. */
export type EntityKind =
  | "level"
  | "space"
  | "wall"
  | "slab"
  | "ceiling"
  | "opening"
  | "electrical_equipment"
  | "electrical_device"
  | "port"
  | "obstacle"
  | "route_constraint"
  | "route"
  | "route_fitting"
  | "circuit"
  | "conductor";

/** Top-level collection name -> the entity kind it holds. */
export const COLLECTION_KIND = {
  levels: "level",
  spaces: "space",
  walls: "wall",
  slabs: "slab",
  ceilings: "ceiling",
  openings: "opening",
  electrical_equipment: "electrical_equipment",
  electrical_devices: "electrical_device",
  ports: "port",
  obstacles: "obstacle",
  route_constraints: "route_constraint",
  routes: "route",
  route_fittings: "route_fitting",
  circuits: "circuit",
  conductors: "conductor",
} as const satisfies Record<string, EntityKind>;

export type CollectionName = keyof typeof COLLECTION_KIND;
export const COLLECTIONS = Object.keys(COLLECTION_KIND) as CollectionName[];

/** Any canonical entity, for code that only needs id/name/provenance. */
export type AnyEntity = EntityBase & Record<string, unknown>;
