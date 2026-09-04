# officeadmin-geo

Standalone geospatial operations map and reusable map packages for OfficeAdmin.

The repository is intentionally independent from `officeadmin-books` so the map can be built, tested, and visually iterated without running OfficeAdmin CI.

## Architecture

```text
apps/
  demo/                 Standalone visual development app
packages/
  geo-types/            Provider-neutral geographic entity contracts
  geo-map/              Host-facing reusable map component
  provider-mapbox/      Mapbox rendering implementation
docs/
  SPEC.md               Product and integration specification
```

The long-term OfficeAdmin integration should import the map package and translate OA records into generic map entities. The map packages must not access the OfficeAdmin database directly.

## Current bootstrap

The first branch includes:

- Mapbox Standard 3D as the initial renderer
- deterministic Los Angeles demo sites
- technician locations with heading and stale-location state
- clustered job markers
- route overlays
- site and technician selection
- camera fly-to behavior
- responsive standalone demo UI

Apple, Google reality layers, parcels, and other GIS providers are intentionally deferred until the core visual experience is approved.

## Run locally

Requirements: Node.js and pnpm.

```bash
pnpm install
cp apps/demo/.env.example apps/demo/.env.local
# replace the placeholder with a public Mapbox token
pnpm dev
```

Then open the Vite URL printed in the terminal.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

See [`docs/SPEC.md`](docs/SPEC.md) for the complete design and integration boundary.
