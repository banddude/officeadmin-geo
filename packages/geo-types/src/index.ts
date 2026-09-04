export interface MapSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  status?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface MapTechnician {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  lastUpdatedAt?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface MapRoutePoint {
  latitude: number;
  longitude: number;
}

export interface MapRoute {
  id: string;
  technicianId?: string;
  points: MapRoutePoint[];
  stops?: Array<MapRoutePoint & { siteId?: string }>;
  metadata?: Record<string, unknown>;
}

export interface MapArea {
  id: string;
  name?: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface GeoOperationsMapData {
  sites?: MapSite[];
  technicians?: MapTechnician[];
  routes?: MapRoute[];
  areas?: MapArea[];
}
