/*
 * displayThickness.ts -- the display-thickness ruling (officeadmin-building-model
 * issue #88, APPROVED by the owner), ported from the E4 viewer.
 *
 * A RoomPlan capture reports wall surfaces without thickness, so the importer
 * honestly records 0.001 m. Extruded faithfully, that wall is an invisible line,
 * while furniture with measured extents renders as solid volumes. Every layer
 * behaved correctly and the picture was unusable.
 *
 * The ruling separates what the building IS from what the picture SHOWS:
 *
 *   1. The model is never modified. `thickness_m` stays 0.001 m. The drawn
 *      value lives only on the drawable, and nothing writes it back -- not to
 *      the model, an export, or a quantity.
 *   2. Each substitution is recorded per element, carrying the recorded value,
 *      the drawn value and the reason, and the element panel shows the two
 *      side by side.
 *   3. A substituted element is never drawn as a filled solid: "filled" means
 *      "the shape comes from canonical dimensions", and once a dimension is the
 *      viewer's that is no longer true.
 *   4. The minimum is a LABELLED RENDERING PARAMETER, not a silent constant:
 *      passed in, shown on screen, explained, adjustable, deep-linkable and
 *      printed in the render stamp. A hard-coded value would be the same failure
 *      as a hard-coded conduit size.
 *
 * It applies to this viewer and stops there. It never reaches IFC.
 */
import type { EntityKind } from "./canonical";

/** Metres in one inch, exactly. */
export const METRES_PER_INCH = 0.0254;

/**
 * The default minimum DRAWN thickness: 4.5 in = 0.1143 m. This is the default
 * Mike's floor-plan editor gives an unscanned wall, so a wall with no measured
 * thickness is drawn at the value a person already sees for such walls. E4
 * used 0.100 m; the value is a parameter precisely so it can differ.
 */
export const DEFAULT_MIN_DRAWN_THICKNESS_M = 4.5 * METRES_PER_INCH;

export const MIN_DRAWN_THICKNESS_LABEL = "Minimum drawn thickness";

/** The choices the element panel offers. 0 draws exactly what the model says. */
export const MIN_DRAWN_THICKNESS_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Off: draw exactly what the model says" },
  { value: 0.025, label: "25 mm" },
  { value: 0.05, label: "50 mm" },
  { value: 0.1, label: "100 mm" },
  { value: DEFAULT_MIN_DRAWN_THICKNESS_M, label: "4.5 in (114.3 mm), floor-plan editor default" },
  { value: 0.15, label: "150 mm" },
];

/**
 * Which canonical fields may be substituted, on which kinds. Deliberately
 * narrow: opening and device sizes are drawn FILLED, and inflating a filled
 * solid's dimension is exactly the claim this mechanism exists to avoid.
 */
export const THICKNESS_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(["wall", "slab", "ceiling"]);

export interface ThicknessSubstitution {
  field: "thickness_m";
  recorded_m: number;
  drawn_m: number;
  why: string;
}

export function normaliseMinDrawnThickness(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  // A drawing parameter, not a model value: clamp to something that can still
  // be called a wall rather than letting a typo draw a 3 m slab of ink.
  return Math.min(numeric, 0.5);
}

/**
 * Decide whether an element's recorded thickness must be DRAWN thicker.
 * Returns null when the recorded value is drawn as-is.
 */
export function substituteThickness(
  kind: EntityKind,
  recorded: unknown,
  minDrawn: number,
): ThicknessSubstitution | null {
  if (!THICKNESS_KINDS.has(kind)) return null;
  if (!(minDrawn > 0)) return null;
  if (typeof recorded !== "number" || !Number.isFinite(recorded)) return null;
  if (recorded >= minDrawn) return null;
  return {
    field: "thickness_m",
    recorded_m: recorded,
    drawn_m: minDrawn,
    why:
      `The model records ${recorded} m, which is too thin to see. It is DRAWN at ${round(minDrawn, 4)} m ` +
      "so the element is visible. The drawn value is a rendering choice, not a measurement, and the model is unchanged.",
  };
}

export function formatThicknessParameter(minDrawn: number): string {
  if (!(minDrawn > 0)) return "exact model thickness";
  const mm = round(minDrawn * 1000, 1);
  const inches = round(minDrawn / METRES_PER_INCH, 2);
  return `${mm} mm (${inches} in)`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
