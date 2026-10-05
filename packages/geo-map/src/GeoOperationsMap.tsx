import type { GeoOperationsMapData } from "@officeadmin-geo/geo-types";
import {
  MapboxGeoMap,
  type GeoMapViewMode,
  type GeoMapVisualTheme,
} from "@officeadmin-geo/provider-mapbox";

export interface GeoOperationsMapProps extends GeoOperationsMapData {
  mapboxAccessToken: string;
  className?: string;
  visualTheme?: GeoMapVisualTheme;
  viewMode?: GeoMapViewMode;
  selectedSiteId?: string;
  selectedTechnicianId?: string;
  onSiteSelected?: (siteId: string) => void;
  onTechnicianSelected?: (technicianId: string) => void;
}

export function GeoOperationsMap(props: GeoOperationsMapProps) {
  const {
    mapboxAccessToken,
    className,
    visualTheme,
    viewMode,
    sites,
    technicians,
    routes,
    areas,
    selectedSiteId,
    selectedTechnicianId,
    onSiteSelected,
    onTechnicianSelected,
  } = props;

  void areas;

  return (
    <MapboxGeoMap
      accessToken={mapboxAccessToken}
      className={className}
      visualTheme={visualTheme}
      viewMode={viewMode}
      sites={sites}
      technicians={technicians}
      routes={routes}
      selectedSiteId={selectedSiteId}
      selectedTechnicianId={selectedTechnicianId}
      onSiteSelected={onSiteSelected}
      onTechnicianSelected={onTechnicianSelected}
    />
  );
}
