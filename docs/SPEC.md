# OfficeAdmin Geo Operations Map

## Goal

Build a standalone, production-quality geospatial operations application that can later be embedded into OfficeAdmin with minimal integration work.

The application should provide a clean, bright, highly accurate 2D and 3D view of real-world geography for visualizing jobs, customer sites, technicians, routes, service areas, project locations, and construction/property context.

The standalone repository exists so the map can be developed, tested, benchmarked, and visually iterated without invoking the full OfficeAdmin CI/deployment pipeline.

## Core principle

Use the best provider for each type of data or experience rather than forcing one vendor to provide everything.

### Mapbox

Primary interactive map renderer for the first milestone.

Use for:

- clean vector basemap
- 3D buildings
- terrain
- roads
- camera/navigation
- custom styling
- jobs and technician visualization
- clustering
- routes
- custom layers
- feature interaction

Mapbox is the primary visual canvas unless testing demonstrates a better solution.

### Apple Maps / MapKit

Optional provider for capabilities where Apple is materially better, such as Look Around, Apple Maps handoff, search, geocoding, or directions. Apple integration must remain modular and must not be required by the core renderer.

### Google Maps Platform

Use only for capabilities where Google provides unique value and licensing permits the integration. Initial candidates are Photorealistic 3D Tiles and Street View. Treat photorealistic content as a separate Site Reality mode rather than the primary clean operations map.

### Public GIS / government data

Support authoritative public GIS data through adapters. Los Angeles is the initial proving ground. Candidate layers include parcels, assessor data, building footprints, zoning, jurisdiction boundaries, permits, and other relevant public datasets.

## Product experience

### Operations view

The default map should be visually clean and bright:

- light background
- clean geometric buildings
- muted terrain
- subdued roads
- restrained labels
- strong depth cues and shadows
- OfficeAdmin operational data visually dominant over the basemap

The city should feel real and spatially accurate without resembling raw photogrammetry.

### Site view

Selecting a site should smoothly move the camera to the property/building and show the selected site, parcel boundary when available, nearby roads, surrounding buildings, and host-provided project metadata.

Optional reality experiences may later include satellite imagery, Google Photorealistic 3D, Apple Look Around, and Google Street View.

### Technician view

Selecting a technician should fly to that technician, persist selection, show heading and location age, show current/assigned destinations when supplied, and optionally show the technician's route.

The UI must clearly distinguish live/recent, stale, and historical locations. Never imply stale GPS data is live.

## Generic entity model

The mapping packages must understand generic geospatial entities rather than OfficeAdmin database models.

```ts
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
```

OfficeAdmin-specific schemas must not leak into the standalone map engine.

## Zoom behavior

### Regional

Show site clusters, technician distribution, and service areas while suppressing unnecessary detail.

### City

Show individual jobs, technicians, routes, and major contextual labels.

### Neighborhood

Show individual buildings, site labels, selected routes, and parcels when enabled.

### Site

Show detailed building/site context, parcels, surrounding structures, entrances, and custom site annotations where available.

## 3D buildings

3D buildings are a first-class part of the experience.

Requirements:

- clean geometry
- fast rendering
- good depth cues
- selectable where practical
- smooth 2D/3D transitions
- ability to emphasize the selected building/site

The basemap should remain visually quiet.

## Provider architecture

External systems must sit behind adapters.

```text
packages/
  geo-map/
  geo-types/
  provider-mapbox/
  provider-apple/
  provider-google/
  provider-gis/
```

Candidate provider interfaces include:

```ts
export interface GeocoderProvider {}
export interface RoutingProvider {}
export interface StreetViewProvider {}
export interface Reality3DProvider {}
export interface ParcelProvider {}
export interface PlaceProvider {}
```

No feature should depend directly on a provider where a useful generic interface can be maintained.

## OfficeAdmin integration boundary

The standalone project must not access the OfficeAdmin database directly.

OfficeAdmin should eventually provide normalized data through a thin adapter:

```tsx
<GeoOperationsMap
  sites={sites}
  technicians={technicians}
  routes={routes}
  areas={areas}
  onSiteSelected={handleSiteSelected}
  onTechnicianSelected={handleTechnicianSelected}
/>
```

The map package owns rendering and geospatial interaction.

OfficeAdmin owns authentication, permissions, business records, technician records, project records, scheduling, and business logic.

Do not use an iframe as the final integration mechanism. The map must be importable as a package.

## Repository structure

```text
/
  apps/
    demo/
  packages/
    geo-map/
    geo-types/
    provider-mapbox/
    provider-apple/
    provider-google/
    provider-gis/
```

The demo app exists for isolated development and visual iteration. Packages must remain usable independently of the demo.

## Demo requirements

The demo must include deterministic Los Angeles sample data:

- multiple sites
- at least three technicians
- technician heading
- fresh and stale GPS examples
- multiple job statuses
- multiple routes
- selected site scenario
- selected technician scenario
- polygon/service-area example

Temporary development controls should support map pitch, bearing, zoom, 2D/3D, buildings, terrain, labels, jobs, technicians, routes, parcels, and future reality modes.

## Performance

Target smooth use on modern iPhone, iPad, desktop Safari, and desktop Chrome.

Design for at least:

- 10,000 sites
- 100 technician locations
- hundreds of route segments

Prefer native map layers and GPU rendering for large data sets rather than thousands of DOM markers.

## Mobile

Mobile is a first-class target. Support single-finger pan, pinch zoom, pitch, large touch targets, bottom-sheet-friendly selection, no hover dependency, and smooth camera transitions.

## Privacy

Technician location is sensitive operational information.

The map should not send technician data to providers that do not need it, persist location history unless the host requests it, or include customer addresses/technician coordinates in analytics payloads unless deliberately enabled.

Authorization remains the host application's responsibility.

## Testing

### Unit

- geometry utilities
- data normalization
- stale-location determination
- clustering helpers
- provider adapters

### Integration

- site selection
- technician selection
- mode changes
- filters
- provider fallback behavior

### Visual

Maintain deterministic screenshot scenarios for:

- Los Angeles overview
- neighborhood view
- site selected
- technician selected
- route displayed
- mobile layout
- 3D building view

## CI

Standalone CI should remain intentionally lightweight:

- lint
- TypeScript
- unit tests
- focused integration tests
- build
- selected visual regression tests

Do not invoke OfficeAdmin CI for this repository.

## Milestone 1

Build only what is required to prove the core experience:

1. standalone repository and workspace
2. demo application
3. Mapbox Standard 3D
4. Los Angeles default scene
5. deterministic example sites
6. deterministic example technicians
7. site clustering
8. technician heading/location age
9. routes
10. site selection and camera flight
11. technician selection and camera flight
12. 2D/3D transitions
13. initial bright visual theme
14. responsive mobile behavior
15. screenshot-based visual tests

Stop and evaluate the actual UX before adding additional providers.

## Milestone 2 candidates

After visual approval, evaluate each independently:

- LA County parcels
- Apple Look Around
- Apple directions/search
- Google Street View
- Google Photorealistic 3D site mode
- satellite mode
- improved routing
- building selection
- site boundary highlighting

Add an integration only if it materially improves the product.

## Non-goals for initial development

Do not build dispatch scheduling, CRM, estimating, project management, technician timekeeping, chat, turn-by-turn navigation, complex GIS editing, or a full Google Earth replacement.

This repository owns excellent geospatial visualization and interaction.

## Success criteria

Milestone 1 succeeds when:

1. Los Angeles looks clean, bright, accurate, and modern.
2. Jobs are easier to understand spatially than on a traditional pin map.
3. Technician locations are obvious without clutter.
4. Moving between city, technician, and site views feels polished.
5. The map feels like a major OfficeAdmin interface rather than an embedded third-party map.
6. The finished component can be imported into OfficeAdmin without rebuilding it.
