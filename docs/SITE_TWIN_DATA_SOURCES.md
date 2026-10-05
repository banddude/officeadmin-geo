# Site Twin Data Source Specification

## Goal

Use measured public geospatial data for facts that can be measured, and use vision for appearance/detail that maps do not encode.

## Los Angeles County prototype sources

### Parcel boundary

ArcGIS layer:

`https://rpgis.isd.lacounty.gov/arcgis/rest/services/GISNET/GISNET_Public/MapServer/333`

Query by point with WGS84 input and GeoJSON output.

Useful fields:

- AIN,
- APN,
- SitusAddress,
- SitusCity,
- SitusZIP.

Normalized output:

```ts
interface ParcelFeature {
  id: string;
  apn?: string;
  address?: string;
  polygon: Position[];
}
```

### Building outline and measured height

ArcGIS layer:

`https://rpgis.isd.lacounty.gov/arcgis/rest/services/GISNET_Public/MapServer/434`

Useful fields:

- OBJECTID,
- HEIGHT,
- ELEV,
- STATUS,
- footprint geometry.

The provider returns building height in feet. Normalize to meters in the provider adapter.

The Corralitas prototype point already returns the actual irregular building polygon and a measured height of 30.57 feet from this layer.

### Land cover

Candidate service:

`https://image.gis.lacounty.gov/image/rest/services/LARIAC7/LANDCOVER_2023/MapServer`

Relevant classes:

- tree canopy,
- grass/shrubs,
- tall shrubs,
- bare soil,
- water,
- buildings,
- roads/railroads,
- other paved.

This can later drive grass, paved surfaces, and vegetation placement without asking AI to guess every ground region.

### Terrain elevation

USGS 3D Elevation Program Elevation Point Query Service (EPQS):

`https://epqs.nationalmap.gov/v1/json`

The research provider samples a small regular grid around the parcel and normalizes elevations to meters. The renderer uses relative local elevation so sloped sites such as Corralitas are represented as sloped geometry rather than a flat ground plane.

Each terrain sample records the USGS raster ID and reported source resolution when returned.

The initial Corralitas query resolves at approximately 1 meter source resolution.

## Geocoding

The reconstruction CLI supports explicit lat/lng so the entire pipeline does not depend on one geocoder.

For arbitrary address input, use a geocoder adapter.

Initial implementation may use Nominatim/OpenStreetMap for research geocoding with a descriptive User-Agent.

Normalized output:

```ts
interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  provider: string;
  providerId?: string;
}
```

## Street-level imagery

### Google Street View research adapter

Primary automatic research source for the Corralitas prototype because coverage is substantially closer to the parcel than the available open imagery. Discovery is automatic by coordinate. The adapter ranks nearby panoramas, computes the parcel bearing, converts that heading into panorama coordinates, fetches only the necessary tiles, and emits a target-facing crop for vision analysis.

The resulting `StreetImageCandidate` remains provider-neutral to the core pipeline. Provider-specific panorama heading is preserved only in provenance.

### KartaView

Open automatic fallback source.

Nearby endpoint:

```text
GET https://api.openstreetcam.org/2.0/photo/
  ?lat={lat}
  &lng={lng}
  &zoomLevel={zoom}
  &join=sequence
  &orderBy=id
  &orderDirection=desc
```

Public imagery discovery requires no user account for the initial research workflow.

Normalize every photo to:

```ts
interface StreetImageCandidate {
  id: string;
  provider: "kartaview";
  sequenceId?: string;
  lat: number;
  lng: number;
  headingDeg?: number;
  capturedAt?: string;
  imageUrl: string;
  thumbnailUrl?: string;
}
```

## Ranking street images

For each candidate compute:

- distance from camera to parcel centroid,
- bearing from camera to parcel centroid,
- angular error between camera heading and parcel bearing,
- recency where available,
- sequence diversity,
- spatial diversity from already selected images.

Suggested base score:

```text
score =
  distanceScore * 0.40 +
  headingScore * 0.45 +
  recencyScore * 0.05 +
  qualityScore * 0.10
```

Heading score is the most important factor for directional still imagery because a close image facing away from the house is not useful. A 360-degree panorama is first converted into a target-facing view, so its generated view heading is the parcel bearing.

## Provider provenance

Every generated site twin must record where geometry and imagery facts came from.

Example:

```json
{
  "geometrySources": [
    {
      "provider": "lacounty-parcel",
      "featureId": "..."
    },
    {
      "provider": "lacounty-building-2023",
      "featureId": "883214"
    }
  ],
  "imagerySources": [
    {
      "provider": "kartaview",
      "imageId": "...",
      "sequenceId": "..."
    }
  ]
}
```

## Source strategy beyond Los Angeles

The core model must not assume LA County forever.

Future adapters can provide the same normalized data from:

- city/county GIS,
- OpenStreetMap,
- national building-footprint datasets,
- commercial imagery or geometry providers,
- user-captured site scans,
- other street imagery platforms.

The fusion/renderer layers should not care which provider supplied the geometry.


## High-resolution land cover

LA County LARIAC 2023 exposes a public four-inch classified land-cover map service. The prototype samples it around the target parcel and normalizes cells to:

- tree canopy,
- grass/shrubs,
- tall shrubs,
- bare soil,
- water,
- buildings,
- roads/railroads,
- other paving.

These cells drive deterministic stylized ground surfaces. AI may refine semantic details, but it does not need to guess where broad grass, paving, roads, or tree canopy exist when measured classification is available.

### Building elevation rule on hillsides

The 2023 building layer exposes both roof elevation and a `HEIGHT` attribute. On steep terrain, `HEIGHT` can include terrain relief and produce visually impossible towers. The prototype therefore samples USGS ground elevation at each building centroid and preserves the County roof elevation. The renderer derives visible building height from the difference. Raw `HEIGHT` remains provenance/fallback data only.
