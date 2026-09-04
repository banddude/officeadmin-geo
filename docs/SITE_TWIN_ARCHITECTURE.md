# Site Twin Architecture

## System shape

The Site Twin prototype is split into five responsibilities:

```text
address
  |
  v
geospatial providers
  |  parcel, footprint, height, roads, terrain
  v
imagery providers
  |  nearby street images with camera metadata
  v
vision extractor
  |  structured observations per image
  v
fusion engine
  |  semantic site model with confidence and provenance
  v
stylized renderer
```

Each responsibility sits behind a narrow interface so providers can be swapped independently.

## Packages

```text
packages/
  site-twin-core/
  provider-lacounty/
  provider-kartaview/
  provider-ollama/
  provider-usgs/
  site-twin-renderer/
```

### site-twin-core

Owns:

- canonical types,
- geometry helpers,
- street-image ranking,
- observation validation,
- confidence-weighted fusion,
- provenance records,
- deterministic scene normalization.

It must not make network requests.

### provider-lacounty

Owns public LA County ArcGIS queries used by the prototype:

- Parcel Boundary layer,
- Building Outline 2023 layer,
- future land-cover adapter,
- future contour/elevation adapter.

It converts ArcGIS responses into provider-neutral core types.

### provider-kartaview

Owns KartaView discovery and photo metadata normalization.

The initial flow is:

1. nearby photo query around parcel centroid,
2. normalize sequence/photo metadata,
3. compute distance to parcel,
4. compute bearing from camera to parcel,
5. compare camera heading to target bearing,
6. rank candidate views,
7. expose image URLs for the reconstruction runner.

### provider-usgs

Owns local terrain sampling through USGS EPQS. It samples a regular grid around the parcel, preserves source-resolution provenance, and returns provider-neutral `TerrainSample` values.

### provider-ollama

Owns local vision calls.

Default research model:

`gemma3:4b`

Responsibilities:

- accept local image file or downloaded image bytes,
- send image plus strict schema prompt to Ollama,
- require JSON output,
- validate and normalize output,
- retry malformed JSON with a correction prompt,
- return one VisualObservation per source image.

### site-twin-renderer

Owns only deterministic rendering from SemanticSiteModel.

It must never call an imagery or AI provider.

Initial renderer:

- React,
- Three.js through react-three-fiber,
- OrbitControls for research inspection,
- orthographic/perspective camera presets,
- low-poly trees,
- simplified materials,
- extruded parcel/building geometry,
- semantic facade openings.

## Reconstruction runner

The CLI is the research orchestrator.

Example:

```bash
pnpm site-twin:reconstruct -- \
  --address "2629 Corralitas Dr, Los Angeles, CA 90039" \
  --output apps/site-twin-demo/public/site-twin.json
```

Pipeline:

1. geocode address if coordinates are not supplied,
2. query parcel containing the point,
3. query buildings intersecting or near the parcel,
4. choose primary building,
5. discover street imagery around the site,
6. rank candidates,
7. download the top N distinct viewpoints to a temporary directory,
8. analyze each with Gemma,
9. fuse observations,
10. write a portable semantic JSON artifact.

The JSON artifact contains source metadata and derived facts, not source image bytes.

## Primary building selection

For v0:

1. prefer a building polygon containing the geocoded address point,
2. otherwise prefer a building whose centroid lies inside the parcel,
3. otherwise prefer the largest building intersecting the parcel,
4. otherwise use the nearest building within a small threshold.

Record which rule selected the primary building.

## Coordinate handling

Provider responses remain WGS84 longitude/latitude.

The renderer converts coordinates into local meters relative to a scene origin using an equirectangular approximation suitable for a single parcel/neighborhood.

For point `(lat, lon)` relative to `(lat0, lon0)`:

```text
x = (lon - lon0) * cos(lat0) * earthRadius
z = -(lat - lat0) * earthRadius
```

This is accurate enough for the small research scene and keeps Three.js coordinates numerically stable.

## Confidence model

Each observation carries:

- model confidence,
- source image score,
- image distance,
- camera-heading agreement,
- optional visibility confidence.

The fused confidence for a fact is weighted by those inputs.

Facts should be represented as:

```ts
interface FusedValue<T> {
  value: T;
  confidence: number;
  sourceImageIds: string[];
  alternatives?: Array<{ value: T; confidence: number }>;
}
```

This avoids pretending ambiguous facade observations are certain.

## Provider fallback order

For the research prototype:

### Geometry

1. LA County authoritative public GIS when the address is in Los Angeles County,
2. OpenStreetMap fallback later,
3. inferred geometry only as a last resort.

### Street imagery

1. KartaView automatic discovery,
2. additional street-image providers behind the same interface,
3. no-image mode renders measured geometry only.

### Vision

1. local Ollama Gemma,
2. another local vision model can be substituted through the same interface.

## Data lifecycle

Downloaded source images are temporary research inputs.

Generated artifacts retain:

- source provider,
- source image ID,
- capture coordinates,
- capture timestamp if available,
- model observations,
- fused facts,
- geometry provider provenance.

They do not need to retain source image bytes.

## Separation from Mapbox

Mapbox remains the city/operations renderer.

Site Twin is intentionally independent from the Mapbox provider package. The selected property can later be entered through a Mapbox click, but detailed reconstruction and rendering are separate concerns.
