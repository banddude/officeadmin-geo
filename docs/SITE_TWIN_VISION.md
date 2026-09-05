# Site Twin Vision Extraction Specification

## Goal

Turn each automatically selected street-level image into a strict structured observation describing only visible facts that are useful for reconstruction.

The model is an extractor, not a scene generator.

## Default model

Research default:

`gemma3:4b` through local Ollama.

The implementation must keep the model name configurable.

## Image selection requirements

Do not analyze every nearby frame.

The runner should prefer a small set of distinct, high-value viewpoints:

- close to the target parcel,
- camera heading roughly toward the parcel,
- separated along the street so multiple facade angles are represented,
- newer imagery preferred when scores are otherwise similar,
- avoid duplicate consecutive frames when possible.

Default target: 4 images.

Minimum useful target: 2 images.

## Observation schema

Each model result must normalize to:

```ts
interface VisualObservation {
  sourceImageId: string;
  visible: boolean;
  confidence: number;
  storiesApprox?: number;
  roof?: {
    type?: "flat" | "gable" | "hip" | "shed" | "mansard" | "unknown";
    color?: string;
    material?: string;
    rooftopDeck?: boolean;
  };
  facades: Array<{
    wall: "front" | "rear" | "left" | "right" | "unknown";
    confidence: number;
    colors: string[];
    materials: string[];
    windows: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      shape: "rect" | "arched" | "round" | "other";
      frameColor?: string;
      confidence: number;
    }>;
    doors: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      material?: string;
      confidence: number;
    }>;
  }>;
  site: {
    stairs?: boolean;
    retainingWalls?: boolean;
    driveway?: boolean;
    grass?: boolean;
    sidewalk?: boolean;
    curb?: boolean;
    trees?: boolean;
    fence?: boolean;
    dominantHardscape?: string;
  };
  notes?: string[];
}
```

Facade opening coordinates are normalized to the visible wall plane:

- x=0 is wall left,
- x=1 is wall right,
- y=0 is wall bottom,
- y=1 is wall top,
- width/height are normalized fractions.

## Prompt behavior

The prompt must tell the model:

1. identify the primary target building only,
2. mark `visible=false` if the target building is not confidently visible,
3. never infer hidden windows or doors,
4. never use knowledge of the address to invent features,
5. output strict JSON only,
6. provide normalized opening coordinates,
7. use `unknown` instead of guessing roof type,
8. describe appearance, not exact dimensions unless a reliable visual ratio exists.

## Target building disambiguation

The runner can supply context to reduce neighbor confusion:

- approximate parcel bearing from the camera,
- expected building height,
- expected footprint orientation,
- expected number of visible levels if known,
- instruction that the target should lie near the image direction facing the parcel.

The model should not be told visual answers such as facade color or roof type before extraction.

## Validation

Every response is parsed and validated.

Reject or repair results when:

- response contains prose outside JSON,
- confidence is outside 0..1,
- opening coordinates are outside 0..1,
- unsupported roof/wall enum appears,
- required fields are missing,
- impossible negative sizes appear.

The first malformed result should be retried once using the original image and a correction prompt that includes the validation error.

## Multi-view fusion rules

### Roof

Use weighted voting on roof type.

A roof fact is high confidence only when:

- at least two useful views agree, or
- one high-confidence view clearly exposes the roof and no competing observation disagrees.

### Exterior colors/materials

Keep the dominant recurring values. Do not collapse every color mentioned into one facade color.

### Windows and doors

Opening positions are facade-specific.

The fuser should cluster openings by wall and normalized center position. Similar openings from multiple images strengthen confidence instead of becoming duplicates.

### Site features

Boolean site facts use weighted evidence. Positive visible evidence is stronger than absence, because an object may simply be outside a camera view.

Example: one view showing stairs should preserve `stairs=true` even if three other views do not show the stairs.

## Debug artifacts

For every reconstruction run, preserve a machine-readable analysis report containing:

- ranked image list,
- reasons for each image score,
- raw normalized observations,
- rejected observations,
- fusion decisions,
- final semantic values with confidence.

This is essential for improving automation without manually inspecting every failure.

## Semantic massing extraction

A building footprint is a plan-view envelope, not a guarantee that every notch in that polygon extends from local grade to the highest roof elevation. This matters on hillside homes, where raw full-height extrusion can create false tower walls.

When the target building is visible, the vision stage must also describe visible architectural massing:

- number of visible street-facing levels,
- whether the facade is stepped or terraced,
- one normalized volume per visible level or major mass,
- each volume's relative width and depth,
- horizontal center within the measured footprint envelope,
- street-facing setback class,
- observed material and color when clear.

Hidden rear geometry must not be invented. The massing observation only controls the visible stylized representation. Measured GIS remains authoritative for geospatial placement, overall footprint envelope, local ground elevation, and absolute roof elevation.

The fuser currently selects the strongest useful massing observation rather than averaging incompatible volume layouts. This is intentional for the research prototype. A future implementation may fit a joint multi-view volume model once enough independent camera views are available.
