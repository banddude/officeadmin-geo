export type Position = [longitude: number, latitude: number];

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface ProvenanceRecord {
  provider: string;
  featureId?: string;
  sourceUrl?: string;
  capturedAt?: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface ParcelFeature {
  id: string;
  apn?: string;
  address?: string;
  polygon: Position[];
  provenance: ProvenanceRecord;
}

export interface BuildingFeature {
  id: string;
  polygon: Position[];
  heightM?: number;
  groundElevationM?: number;
  roofElevationM?: number;
  areaSqM?: number;
  levels?: number;
  provenance: ProvenanceRecord;
}

export interface LineFeature {
  id: string;
  points: Position[];
  kind?: string;
  widthM?: number;
  provenance?: ProvenanceRecord;
}

export interface TerrainSample {
  coordinate: Coordinate;
  elevationM: number;
  provenance?: ProvenanceRecord;
}

export type GroundCoverClass =
  | "tree_canopy"
  | "grass_shrubs"
  | "tall_shrubs"
  | "bare_soil"
  | "water"
  | "building"
  | "road_railroad"
  | "other_paved";

export interface GroundCoverSample {
  coordinate: Coordinate;
  className: GroundCoverClass;
  provenance?: ProvenanceRecord;
}

export interface SiteGeometry {
  center: Coordinate;
  parcel?: ParcelFeature;
  buildings: BuildingFeature[];
  primaryBuildingId?: string;
  roads: LineFeature[];
  sidewalks: LineFeature[];
  terrain: TerrainSample[];
  groundCover: GroundCoverSample[];
  provenance: ProvenanceRecord[];
}

export interface GeocodeResult extends Coordinate {
  address: string;
  provider: string;
  providerId?: string;
}

export interface StreetImageCandidate extends Coordinate {
  id: string;
  provider: string;
  sequenceId?: string;
  headingDeg?: number;
  capturedAt?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  distanceToTargetM?: number;
  bearingToTargetDeg?: number;
  headingErrorDeg?: number;
  score?: number;
  scoreReasons?: string[];
  provenance?: ProvenanceRecord;
}

export type RoofType = "flat" | "gable" | "hip" | "shed" | "mansard" | "unknown";
export type WallName = "front" | "rear" | "left" | "right" | "unknown";

export interface VisualOpening {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  color?: string;
  material?: string;
  shape?: "rect" | "arched" | "round" | "other";
}

export interface VisualFacadeObservation {
  wall: WallName;
  confidence: number;
  colors: string[];
  materials: string[];
  windows: VisualOpening[];
  doors: VisualOpening[];
}

export interface VisualMassingVolume {
  level: number;
  widthFraction: number;
  depthFraction?: number;
  horizontalCenter: number;
  setback?: "none" | "slight" | "moderate" | "deep" | "unknown";
  color?: string;
  material?: string;
  confidence: number;
}


export type FacadeComponentKind = "volume" | "tower" | "balcony" | "chimney" | "other";

export interface VisualFacadeComponent {
  kind: FacadeComponentKind;
  x: number;
  width: number;
  bottom: number;
  top: number;
  depthFraction?: number;
  setback?: "none" | "slight" | "moderate" | "deep" | "unknown";
  roofType?: RoofType;
  color?: string;
  material?: string;
  confidence: number;
}

export interface VisualFacadeComposition {
  components: VisualFacadeComponent[];
  confidence: number;
}

export interface VisualMassingObservation {
  storiesVisible?: number;
  stepped?: boolean;
  volumes: VisualMassingVolume[];
  confidence: number;
}

export interface VisualObservation {
  sourceImageId: string;
  visible: boolean;
  confidence: number;
  storiesApprox?: number;
  roof?: {
    type?: RoofType;
    color?: string;
    material?: string;
    rooftopDeck?: boolean;
  };
  massing?: VisualMassingObservation;
  facadeComposition?: VisualFacadeComposition;
  facades: VisualFacadeObservation[];
  site: {
    stairs?: boolean;
    retainingWalls?: boolean;
    driveway?: boolean;
    grass?: boolean;
    sidewalk?: boolean;
    curb?: boolean;
    trees?: boolean;
    fence?: boolean;
    dominantHardscape?: string;
  };
  notes?: string[];
}

export interface FusedAlternative<T> {
  value: T;
  confidence: number;
}

export interface FusedValue<T> {
  value: T;
  confidence: number;
  sourceImageIds: string[];
  alternatives?: FusedAlternative<T>[];
}

export interface SemanticOpening {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  color?: string;
  material?: string;
}

export interface SemanticFacade {
  wall: Exclude<WallName, "unknown">;
  colors: FusedValue<string[]>;
  materials: FusedValue<string[]>;
  windows: SemanticOpening[];
  doors: SemanticOpening[];
}

export interface SemanticFacadeComposition {
  components: VisualFacadeComponent[];
  confidence: number;
  sourceImageIds: string[];
}

export interface SemanticMassing {
  storiesVisible?: number;
  stepped: boolean;
  volumes: VisualMassingVolume[];
  confidence: number;
  sourceImageIds: string[];
}

export interface SemanticSiteModel {
  schemaVersion: 1;
  facadeAlignment?: {
    frontEdgeIndex: number;
    sourceImageId: string;
    confidence: number;
  };
  address: string;
  center: Coordinate;
  generatedAt: string;
  geometry: SiteGeometry;
  storiesApprox?: FusedValue<number>;
  massing?: SemanticMassing;
  facadeComposition?: SemanticFacadeComposition;
  roof: FusedValue<{
    type: RoofType;
    color?: string;
    material?: string;
    rooftopDeck?: boolean;
  }>;
  facades: SemanticFacade[];
  site: {
    stairs: FusedValue<boolean>;
    retainingWalls: FusedValue<boolean>;
    driveway: FusedValue<boolean>;
    grass: FusedValue<boolean>;
    sidewalk: FusedValue<boolean>;
    curb: FusedValue<boolean>;
    trees: FusedValue<boolean>;
    fence: FusedValue<boolean>;
    dominantHardscape?: FusedValue<string>;
  };
  imagery: StreetImageCandidate[];
  observations: VisualObservation[];
  warnings: string[];
}

export interface ReconstructionOptions {
  address: string;
  latitude?: number;
  longitude?: number;
  imageLimit?: number;
  imageryRadiusM?: number;
  visionModel?: string;
}
