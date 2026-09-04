import type {
  BuildingFeature,
  Coordinate,
  ParcelFeature,
  Position,
  ProvenanceRecord,
  SiteGeometry,
} from "@officeadmin-geo/site-twin-core";
import { haversineMeters, polygonCentroid } from "@officeadmin-geo/site-twin-core";

const BASE = "https://rpgis.isd.lacounty.gov/arcgis/rest/services/GISNET/GISNET_Public/MapServer";
const PARCEL_LAYER = 333;
const BUILDING_LAYER = 434;
const FEET_TO_METERS = 0.3048;
const SQFT_TO_SQM = 0.09290304;

interface ArcGisFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    id?: string | number;
    type: "Feature";
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
    properties: Record<string, unknown>;
  }>;
}

function firstRing(geometry: ArcGisFeatureCollection["features"][number]["geometry"]): Position[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return ((geometry.coordinates as number[][][])[0] ?? []).map(([longitude, latitude]) => [longitude!, latitude!]);
  }
  const firstPolygon = (geometry.coordinates as number[][][][])[0];
  return (firstPolygon?.[0] ?? []).map(([longitude, latitude]) => [longitude!, latitude!]);
}

async function queryLayerByPoint(layer: number, point: Coordinate, options: { distanceM?: number } = {}) {
  const url = new URL(`${BASE}/${layer}/query`);
  url.searchParams.set("geometry", `${point.longitude},${point.latitude}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("returnGeometry", "true");
  if (options.distanceM) {
    url.searchParams.set("distance", String(options.distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }
  url.searchParams.set("f", "geojson");

  const response = await fetch(url, { headers: { Accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error(`LA County layer ${layer} query failed with ${response.status}`);
  return (await response.json()) as ArcGisFeatureCollection;
}

export async function getParcelAtPoint(point: Coordinate): Promise<ParcelFeature | undefined> {
  const collection = await queryLayerByPoint(PARCEL_LAYER, point);
  const feature = collection.features[0];
  if (!feature) return undefined;
  const polygon = firstRing(feature.geometry);
  const featureId = String(feature.properties.OBJECTID ?? feature.id ?? "unknown");
  const provenance: ProvenanceRecord = {
    provider: "lacounty-parcel",
    featureId,
    sourceUrl: `${BASE}/${PARCEL_LAYER}`,
  };
  return {
    id: featureId,
    apn: typeof feature.properties.APN === "string" ? feature.properties.APN : undefined,
    address: typeof feature.properties.SitusAddress === "string" ? feature.properties.SitusAddress : undefined,
    polygon,
    provenance,
  };
}

export async function getBuildingsNearPoint(point: Coordinate, distanceM = 80): Promise<BuildingFeature[]> {
  let collection = await queryLayerByPoint(BUILDING_LAYER, point);
  if (collection.features.length === 0) {
    collection = await queryLayerByPoint(BUILDING_LAYER, point, { distanceM });
  }

  return collection.features
    .map((feature) => {
      const polygon = firstRing(feature.geometry);
      const heightFeet = Number(feature.properties.HEIGHT);
      const elevationFeet = Number(feature.properties.ELEV);
      const areaSqFt = Number(feature.properties["Shape.STArea()"] ?? feature.properties["cadastral.SDE.LARIAC_BUILDINGS_2023.AREA"]);
      const featureId = String(feature.properties.OBJECTID ?? feature.id ?? "unknown");
      return {
        id: featureId,
        polygon,
        heightM: Number.isFinite(heightFeet) ? heightFeet * FEET_TO_METERS : undefined,
        roofElevationM: Number.isFinite(elevationFeet) ? elevationFeet * FEET_TO_METERS : undefined,
        areaSqM: Number.isFinite(areaSqFt) ? areaSqFt * SQFT_TO_SQM : undefined,
        provenance: {
          provider: "lacounty-building-2023",
          featureId,
          sourceUrl: `${BASE}/${BUILDING_LAYER}`,
          details: {
            status: typeof feature.properties.STATUS === "string" ? feature.properties.STATUS : undefined,
            heightFeet: Number.isFinite(heightFeet) ? heightFeet : undefined,
          },
        },
      } satisfies BuildingFeature;
    })
    .filter((building) => building.polygon.length >= 3);
}

export function choosePrimaryBuilding(point: Coordinate, buildings: BuildingFeature[]) {
  if (buildings.length === 0) return undefined;
  return [...buildings].sort((a, b) => {
    const aDistance = haversineMeters(point, polygonCentroid(a.polygon));
    const bDistance = haversineMeters(point, polygonCentroid(b.polygon));
    if (Math.abs(aDistance - bDistance) > 2) return aDistance - bDistance;
    return (b.areaSqM ?? 0) - (a.areaSqM ?? 0);
  })[0];
}

export async function getLosAngelesSiteGeometry(point: Coordinate): Promise<SiteGeometry> {
  const [parcel, buildings] = await Promise.all([
    getParcelAtPoint(point),
    getBuildingsNearPoint(point),
  ]);
  const primary = choosePrimaryBuilding(point, buildings);

  return {
    center: point,
    parcel,
    buildings,
    primaryBuildingId: primary?.id,
    roads: [],
    sidewalks: [],
    terrain: [],
    provenance: [
      ...(parcel ? [parcel.provenance] : []),
      ...buildings.map((building) => building.provenance),
    ],
  };
}
