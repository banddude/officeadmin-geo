# Stylized Site Twin Research Specification

## Purpose

Build a research prototype that turns a street address into a recognizable, clean, game-style 3D site twin.

The result should look like the real property rather than a generic extruded building. The prototype should preserve the important visual and spatial facts of the site while rendering them as simplified, attractive geometry rather than raw photogrammetry.

The first proving ground is:

`2629 Corralitas Dr, Los Angeles, CA 90039`

## User experience goal

Given an address, the system should automatically:

1. locate the parcel and primary building,
2. load authoritative footprint and height geometry where available,
3. discover nearby street-level imagery,
4. rank images likely to face the target property,
5. analyze multiple views with a local vision model,
6. produce structured facts such as wall color, roof type, window placement, doors, stairs, retaining walls, hardscape, and vegetation,
7. fuse those facts into a semantic scene model,
8. render a stylized 3D version of the property and immediate street context.

The desired result is not a photorealistic copy. It is a recognizable animated representation of the actual place.

## Visual fidelity targets

At selected-site zoom, the twin should attempt to preserve:

- parcel shape,
- primary building footprint,
- building height and approximate story count,
- roof type and important roof forms,
- dominant exterior colors,
- major facade materials,
- recognizable large windows and doors,
- stairs and major grade changes,
- retaining walls,
- driveway and paved areas,
- sidewalk and curb,
- street alignment,
- grass and planting zones,
- large trees and other dominant vegetation.

Fine decorative details are lower priority than recognizable structure.

## Research principles

### Geometry before inference

Measured geometry should win over visual guesses where a reliable data source exists.

Examples:

- county building footprint beats a vision-estimated footprint,
- measured building height beats a guessed story height,
- parcel polygon beats a guessed lot boundary,
- road centerline beats a guessed road location.

### AI as structured visual extraction

The vision model should not generate the final scene directly. It should describe observable facts in a strict schema.

Example:

```json
{
  "roof": { "type": "flat", "color": "dark gray" },
  "facades": [
    {
      "wall": "front",
      "colors": ["white"],
      "windows": [
        { "x": 0.22, "y": 0.68, "width": 0.28, "height": 0.18 }
      ],
      "doors": [
        { "x": 0.72, "y": 0.0, "width": 0.12, "height": 0.34 }
      ]
    }
  ]
}
```

The renderer converts the semantic facts into deterministic geometry.

### Multi-view agreement

Never trust one street image for important geometry or appearance facts when multiple views are available.

Each observation carries confidence. The fusion stage combines evidence across images and records disagreement instead of silently inventing certainty.

## Scope

### Included in the research prototype

- address input,
- geocoding,
- LA County parcel lookup,
- LA County building footprint and height lookup,
- nearby street imagery discovery,
- image ranking by location and camera direction,
- Ollama and Gemma vision extraction,
- semantic observation schema,
- multi-image fusion,
- stylized Three.js rendering,
- generated JSON artifact for a site,
- Corralitas fixture and one-command reconstruction path.

### Deferred

- survey-grade precision,
- exact BIM reconstruction,
- city-wide precomputation,
- production caching infrastructure,
- production user permissions,
- OfficeAdmin business data integration,
- photorealistic texture projection,
- automatic Google/Apple imagery adapters,
- production billing controls,
- production source licensing decisions.

## Success criteria for the first prototype

The Corralitas run succeeds when:

1. the system identifies the correct parcel and primary building without manual drawing,
2. the real building footprint is used,
3. the measured building height is used when available,
4. street imagery is discovered automatically where coverage exists,
5. Gemma returns structured observations for multiple images,
6. the fused scene model records confidence and provenance,
7. the browser renders a sloped site with parcel, street, sidewalk, building, roof, major openings, stairs, vegetation, and simplified materials,
8. a human familiar with the property can recognize it as that property rather than a generic house.

## Integration with OfficeAdmin Geo

The Site Twin subsystem is a selected-site detail engine. It does not replace the Mapbox operations map.

Expected flow:

```text
OfficeAdmin operations map
        |
        | select job/site
        v
Site Twin scene loader
        |
        v
Stylized detailed property view
```

The operations map remains optimized for thousands of jobs and live technicians. Site Twin is loaded only for properties where close-up detail is useful.
