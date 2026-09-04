import { useEffect, useRef } from "react";
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  GeoOperationsMapData,
  MapRoute,
  MapSite,
  MapTechnician,
} from "@officeadmin-geo/geo-types";

const DEFAULT_CENTER: [number, number] = [-118.2437, 34.0522];
const STALE_AFTER_MS = 15 * 60 * 1000;

export interface MapboxGeoMapProps extends GeoOperationsMapData {
  accessToken: string;
  className?: string;
  selectedSiteId?: string;
  selectedTechnicianId?: string;
  onSiteSelected?: (siteId: string) => void;
  onTechnicianSelected?: (technicianId: string) => void;
}

function sitesGeoJSON(sites: MapSite[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sites.map((site) => ({
      type: "Feature",
      id: site.id,
      geometry: {
        type: "Point",
        coordinates: [site.longitude, site.latitude],
      },
      properties: {
        id: site.id,
        name: site.name,
        status: site.status ?? "unknown",
        category: site.category ?? "",
      },
    })),
  };
}

function techniciansGeoJSON(
  technicians: MapTechnician[],
): GeoJSON.FeatureCollection {
  const now = Date.now();

  return {
    type: "FeatureCollection",
    features: technicians.map((technician) => {
      const locationTime = technician.lastUpdatedAt
        ? Date.parse(technician.lastUpdatedAt)
        : Number.NaN;
      const stale = !Number.isFinite(locationTime) || now - locationTime > STALE_AFTER_MS;

      return {
        type: "Feature",
        id: technician.id,
        geometry: {
          type: "Point",
          coordinates: [technician.longitude, technician.latitude],
        },
        properties: {
          id: technician.id,
          name: technician.name,
          heading: technician.heading ?? 0,
          stale,
          status: technician.status ?? "unknown",
        },
      };
    }),
  };
}

function routesGeoJSON(routes: MapRoute[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes
      .filter((route) => route.points.length >= 2)
      .map((route) => ({
        type: "Feature",
        id: route.id,
        geometry: {
          type: "LineString",
          coordinates: route.points.map((point) => [point.longitude, point.latitude]),
        },
        properties: {
          id: route.id,
          technicianId: route.technicianId ?? "",
        },
      })),
  };
}

function upsertSources(
  map: MapboxMap,
  sites: MapSite[],
  technicians: MapTechnician[],
  routes: MapRoute[],
) {
  const siteData = sitesGeoJSON(sites);
  const technicianData = techniciansGeoJSON(technicians);
  const routeData = routesGeoJSON(routes);

  const existingSites = map.getSource("oa-sites") as GeoJSONSource | undefined;
  if (existingSites) {
    existingSites.setData(siteData);
  } else {
    map.addSource("oa-sites", {
      type: "geojson",
      data: siteData,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 48,
    });

    map.addLayer({
      id: "oa-site-clusters",
      type: "circle",
      source: "oa-sites",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#111827",
        "circle-radius": ["step", ["get", "point_count"], 18, 25, 23, 100, 29],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    map.addLayer({
      id: "oa-site-cluster-count",
      type: "symbol",
      source: "oa-sites",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    map.addLayer({
      id: "oa-sites",
      type: "circle",
      source: "oa-sites",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "match",
          ["get", "status"],
          "active",
          "#16a34a",
          "scheduled",
          "#2563eb",
          "bid",
          "#f59e0b",
          "complete",
          "#6b7280",
          "#7c3aed",
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 15, 9],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    map.addLayer({
      id: "oa-site-labels",
      type: "symbol",
      source: "oa-sites",
      filter: ["!", ["has", "point_count"]],
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#111827",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  const existingTechnicians = map.getSource("oa-technicians") as GeoJSONSource | undefined;
  if (existingTechnicians) {
    existingTechnicians.setData(technicianData);
  } else {
    map.addSource("oa-technicians", { type: "geojson", data: technicianData });

    map.addLayer({
      id: "oa-technicians",
      type: "circle",
      source: "oa-technicians",
      paint: {
        "circle-color": ["case", ["get", "stale"], "#9ca3af", "#0f172a"],
        "circle-radius": 10,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });

    map.addLayer({
      id: "oa-technician-heading",
      type: "symbol",
      source: "oa-technicians",
      layout: {
        "text-field": "▲",
        "text-size": 10,
        "text-rotate": ["get", "heading"],
        "text-rotation-alignment": "map",
        "text-offset": [0, -1.8],
      },
      paint: {
        "text-color": ["case", ["get", "stale"], "#9ca3af", "#0f172a"],
      },
    });

    map.addLayer({
      id: "oa-technician-labels",
      type: "symbol",
      source: "oa-technicians",
      minzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#111827",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  const existingRoutes = map.getSource("oa-routes") as GeoJSONSource | undefined;
  if (existingRoutes) {
    existingRoutes.setData(routeData);
  } else {
    map.addSource("oa-routes", { type: "geojson", data: routeData });
    map.addLayer({
      id: "oa-routes",
      type: "line",
      source: "oa-routes",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#2563eb",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 15, 5],
        "line-opacity": 0.76,
      },
    });
  }
}

function fitOperationsOverview(
  map: MapboxMap,
  sites: MapSite[],
  technicians: MapTechnician[],
  duration = 0,
) {
  const coordinates: [number, number][] = [
    ...sites.map((site): [number, number] => [site.longitude, site.latitude]),
    ...technicians.map(
      (technician): [number, number] => [technician.longitude, technician.latitude],
    ),
  ];

  if (!coordinates.length) {
    map.easeTo({ center: DEFAULT_CENTER, zoom: 10.6, pitch: 52, bearing: -10, duration });
    return;
  }

  const bounds = coordinates.reduce(
    (currentBounds, coordinate) => currentBounds.extend(coordinate),
    new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]),
  );

  map.fitBounds(bounds, {
    padding: { top: 110, right: 90, bottom: 110, left: 90 },
    maxZoom: 11.4,
    pitch: 52,
    bearing: -10,
    duration,
  });
}

export function MapboxGeoMap({
  accessToken,
  className,
  sites = [],
  technicians = [],
  routes = [],
  selectedSiteId,
  selectedTechnicianId,
  onSiteSelected,
  onTechnicianSelected,
}: MapboxGeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const siteCallbackRef = useRef(onSiteSelected);
  const technicianCallbackRef = useRef(onTechnicianSelected);

  siteCallbackRef.current = onSiteSelected;
  technicianCallbackRef.current = onTechnicianSelected;

  useEffect(() => {
    if (!containerRef.current || !accessToken || mapRef.current) return;

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      config: {
        basemap: {
          theme: "monochrome",
          lightPreset: "day",
          show3dObjects: true,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          showPedestrianRoads: false,
          showAdminBoundaries: false,
        },
      },
      center: DEFAULT_CENTER,
      zoom: 10.6,
      pitch: 52,
      bearing: -10,
      antialias: true,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("style.load", () => {
      try {
        map.setConfigProperty("basemap", "theme", "monochrome");
        map.setConfigProperty("basemap", "lightPreset", "day");
        map.setConfigProperty("basemap", "show3dObjects", true);
        map.setConfigProperty("basemap", "show3dBuildings", true);
        map.setConfigProperty("basemap", "show3dTrees", true);
        map.setConfigProperty("basemap", "show3dLandmarks", true);
        map.setConfigProperty("basemap", "show3dFacades", true);
        map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
        map.setConfigProperty("basemap", "showTransitLabels", false);
        map.setConfigProperty("basemap", "showPedestrianRoads", false);
        map.setConfigProperty("basemap", "showAdminBoundaries", false);
      } catch {
        // Mapbox Standard adds configuration options over time. Core layers still work.
      }

      upsertSources(map, sites, technicians, routes);
      if (!selectedSiteId && !selectedTechnicianId) {
        fitOperationsOverview(map, sites, technicians);
      }
    });

    map.on("click", "oa-sites", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") siteCallbackRef.current?.(id);
    });

    map.on("click", "oa-technicians", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") technicianCallbackRef.current?.(id);
    });

    map.on("click", "oa-site-clusters", (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const coordinates = feature?.geometry.type === "Point" ? feature.geometry.coordinates : null;
      const source = map.getSource("oa-sites") as GeoJSONSource | undefined;

      if (source && typeof clusterId === "number" && coordinates) {
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error || typeof zoom !== "number") return;
          map.easeTo({ center: coordinates as [number, number], zoom });
        });
      }
    });

    for (const layerId of ["oa-sites", "oa-technicians", "oa-site-clusters"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => upsertSources(map, sites, technicians, routes);
    if (map.isStyleLoaded()) update();
    else map.once("style.load", update);
  }, [sites, technicians, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (site) {
      map.flyTo({
        center: [site.longitude, site.latitude],
        zoom: 17.1,
        pitch: 64,
        bearing: -18,
        duration: 1100,
        essential: true,
      });
    }
  }, [selectedSiteId, sites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const technician = technicians.find(
      (candidate) => candidate.id === selectedTechnicianId,
    );
    if (technician) {
      map.flyTo({
        center: [technician.longitude, technician.latitude],
        zoom: 15.2,
        pitch: 58,
        bearing: -14,
        duration: 1000,
        essential: true,
      });
    }
  }, [selectedTechnicianId, technicians]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedSiteId || selectedTechnicianId || !map.isStyleLoaded()) return;
    fitOperationsOverview(map, sites, technicians, 850);
  }, [selectedSiteId, selectedTechnicianId, sites, technicians]);

  return <div ref={containerRef} className={className} />;
}
