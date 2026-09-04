# officeadmin-geo

Standalone geospatial operations map, reusable map packages, and a research Site Twin engine for OfficeAdmin.

The repository is intentionally independent from `officeadmin-books` so geospatial work can be built, tested, and visually iterated without running OfficeAdmin CI.

## Architecture

```text
apps/
  demo/                     Mapbox operations-map development app
  site-twin-demo/           Stylized property reconstruction research lab
packages/
  geo-types/                Provider-neutral operations-map contracts
  geo-map/                  Host-facing reusable operations-map component
  provider-mapbox/          Mapbox rendering implementation
  site-twin-core/           Site Twin geometry, ranking, fusion, schemas
  provider-lacounty/        LA County parcel/building geometry adapter
  provider-openstreetmap/   Geocoding and local street context
  provider-kartaview/       Open street-image discovery/fallback
  provider-google-streetview-research/  Automatic research panorama discovery + target-facing crops
  provider-ollama/          Local Gemma vision extraction
  provider-usgs/            USGS terrain elevation sampling
  site-twin-renderer/       Deterministic stylized Three.js renderer
docs/
  SPEC.md                    Operations-map product spec
  SITE_TWIN_SPEC.md          Site Twin research product spec
  SITE_TWIN_ARCHITECTURE.md  Pipeline/package architecture
  SITE_TWIN_DATA_SOURCES.md  Geometry and imagery providers
  SITE_TWIN_VISION.md        Gemma extraction and fusion rules
  SITE_TWIN_RENDERER.md      Stylized 3D renderer requirements
  SITE_TWIN_ROADMAP.md       Implementation milestones
```

The long-term OfficeAdmin integration should import these packages and translate OA records into generic geospatial entities. The repository must not access the OfficeAdmin database directly.

## Operations map

The operations-map branch includes:

- Mapbox Standard 3D
- deterministic Los Angeles demo sites
- technician locations with heading and stale-location state
- clustered job markers
- route overlays
- site and technician selection
- camera fly-to behavior
- responsive standalone demo UI

Run it with:

```bash
pnpm install
cp apps/demo/.env.example apps/demo/.env.local
# replace the placeholder with a public Mapbox token
pnpm dev
```

## Site Twin research

The Site Twin prototype turns an address into measured site geometry plus a semantic visual model that can be rendered as a clean game-style property twin.

Current automatic pipeline:

```text
address / coordinates
  -> LA County parcel + 2023 building footprint/height
  -> OpenStreetMap street context
  -> USGS terrain grid
  -> Google Street View research panorama discovery + target-facing crops
  -> KartaView open-imagery fallback
  -> LA County 4-inch land-cover classification
  -> local Ollama Gemma structured visual extraction
  -> multi-view semantic fusion
  -> portable site-twin.json
  -> react-three-fiber stylized renderer
```

The first proving ground is:

`2629 Corralitas Dr, Los Angeles, CA 90039`

Generate it with local Gemma vision enabled:

```bash
pnpm site-twin:corralitas
```

Generate measured geometry and imagery metadata without calling vision:

```bash
pnpm exec tsx scripts/reconstruct-site.ts \
  --address "2629 Corralitas Dr, Los Angeles, CA 90039" \
  --latitude 34.09962 \
  --longitude -118.25278 \
  --output apps/site-twin-demo/public/site-twin.json \
  --no-vision
```

Then run the research viewer:

```bash
pnpm dev:site-twin
```

The generated `site-twin.json` contains normalized provider metadata, semantic observations, fused facts, and measured geometry. Source street-image bytes are not committed into the repo.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

See [`docs/SPEC.md`](docs/SPEC.md) for the operations map and [`docs/SITE_TWIN_SPEC.md`](docs/SITE_TWIN_SPEC.md) for the Site Twin research system.
