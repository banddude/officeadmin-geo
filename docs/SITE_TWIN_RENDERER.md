# Site Twin Renderer Specification

## Design goal

Render the real spatial facts of a site using intentionally simplified, clean, animated-world geometry.

The renderer should feel closer to a polished architectural game environment than GIS, CAD, or photogrammetry.

## Aesthetic direction

- bright daylight,
- soft shadows,
- clean edge definition,
- restrained textures,
- recognizable material color blocks,
- low visual noise,
- slightly softened geometry where it does not damage recognizability,
- landscaping represented with low-poly or simple stylized forms,
- streets and sidewalks clearly distinct but subdued.

The selected building should be visually dominant.

## Geometry hierarchy

```text
scene
  terrain
  parcel
  street
  curb
  sidewalk
  hardscape
  retaining walls
  building
    levels
    facade planes
      windows
      doors
    roof
    railings
  vegetation
```

## Terrain

The local site mesh should support slope.

For v0, a small height field is sufficient. The terrain provider can later be upgraded without changing scene semantics.

The building base elevation should align to terrain rather than floating at world zero.

## Parcel

Render the parcel as a subtle ground region. In inspection/debug mode, allow a parcel boundary outline.

The parcel is not necessarily the grass region.

## Road and sidewalk

Road geometry should follow provider linework and approximate width.

Sidewalk is a distinct raised or offset surface.

Curb should be represented when known, especially on sloped sites where the street edge matters visually.

## Building massing

Start from the authoritative building footprint.

Extrude to measured provider height when available.

If measured height is unavailable:

```text
estimated height = storiesApprox * defaultStoryHeight
```

Default story height for residential research rendering: 3.1 meters.

## Roof generation

### flat

- horizontal roof plane,
- optional parapet,
- optional rooftop-deck rail when semantic model indicates a deck.

### gable

- derive ridge along the long footprint axis by default,
- use a configurable pitch,
- preserve footprint outline where possible.

### hip

- slope roof planes inward toward a ridge/peak approximation.

### shed

- single sloped plane.

### unknown

- use a low-profile flat placeholder with debug indication that roof form is unresolved.

Roof generation must remain replaceable with a more sophisticated procedural mesh generator later.

## Facades

Each footprint edge maps to a facade plane.

The semantic model may name front/rear/left/right walls. The scene builder resolves those semantic labels onto footprint edges using street orientation and building orientation.

A facade should support:

- base color,
- optional accent material regions,
- windows,
- doors,
- balconies/railings later.

## Windows

Windows are deterministic objects attached to wall planes using normalized coordinates.

Initial visual treatment:

- dark or lightly reflective glass,
- thin frame,
- shallow inset or offset,
- no photographic texture.

Large glazing should read as large glazing rather than repeated tiny windows.

## Doors

Doors use normalized facade placement and simplified material/color treatment.

Wood doors should read as wood through color and subtle material roughness, not a photographic texture.

## Stairs

If AI detects stairs and geometry is not otherwise known, generate a configurable stepped run near the front facade/street approach.

Future versions should infer stair direction from image segmentation or mapped elevation transitions.

## Retaining walls

Render major retaining walls as clean concrete/stone volumes along grade transitions when detected.

They are especially important for hillside properties.

## Vegetation

### grass

Use a simple ground material region rather than individual blades.

### trees

Use low-poly trunk/canopy forms with several shape variants.

Tree placement in v0 can be approximate if only presence is known. Later land-cover and imagery segmentation should determine position.

### shrubs

Use clustered low-poly volumes.

## Materials

Semantic color strings must map through a controlled palette instead of directly accepting arbitrary CSS-like model output.

Examples:

- white -> warm white,
- gray -> warm concrete gray,
- dark gray -> charcoal,
- wood -> warm cedar/brown,
- grass -> muted natural green,
- road -> neutral blue-gray asphalt,
- sidewalk -> pale concrete.

The palette should remain attractive even when the model returns coarse color names.

## Camera presets

### inspection

Orbit camera with full controls.

### street

Camera placed near the street-facing side at human eye height.

### site

Three-quarter elevated view showing the full parcel and immediate street.

### roof

Elevated view emphasizing roof geometry and site layout.

## Debug overlays

The research app should optionally expose:

- parcel outline,
- footprint outline,
- facade labels,
- source-image camera positions,
- image heading rays,
- confidence labels,
- raw provider height,
- semantic opening anchors.

Debug overlays are essential during research and should not dictate the final product UI.

## Performance target

A single detailed site scene should remain smooth on current desktop Safari/Chrome and modern iPhone/iPad hardware.

The first prototype should stay below a few thousand draw calls and should prefer instanced vegetation when counts increase.

## Hillside placement

All buildings share the same absolute terrain datum. Each rendered building uses its sampled local ground elevation for its base and County roof elevation for its top when those measurements are available. Terrain and land-cover meshes must cover the complete visible building context so neighboring structures are never positioned by extrapolating a target-parcel-only height field.

Only the primary target building receives target-specific AI facade materials/openings. Neighbor buildings render neutral measured massing until they receive their own observations.

## Hillside massing rule

Do not render the primary building as one full-height extrusion when semantic massing is available.

The renderer constructs a facade-aligned local coordinate frame from the measured footprint and target-facing imagery. Each AI massing volume is then fit inside the measured envelope. The total vertical extent still terminates at the measured absolute roof elevation, while individual visible levels may step back from the street-facing plane.

This separation is important:

- GIS controls where the building is and how high its roof is in world space.
- Terrain controls where walls meet local grade.
- Vision controls the visible arrangement of levels, setbacks, openings, colors, and materials.
- Rendering controls stylization only.

Context buildings may remain simplified terrain-conforming masses until they receive their own imagery reconstruction.

## Art direction

The default research view should read as a clean animated architectural model rather than a GIS debug scene. Use continuous terrain, surface-width roads and sidewalks, low-poly vegetation derived from measured canopy, warm neutral context buildings, dark framed glazing, restrained wood accents, soft atmospheric depth, and directional shadows. Debug overlays and the data inspector are off by default.
