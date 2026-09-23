/*
 * palette.ts -- the visual grammar, ported from the E4 viewer (viewer-core.js):
 *
 *   colour       = provenance class      teal observed / amber user / violet inferred
 *   filled solid = trustworthy shape     only observed or user elements whose
 *                                        shape is canonical and undrawn-with
 *   wire or dash = do not trust the shape  every inferred element, every shape
 *                                        the viewer invented, every element
 *                                        drawn thicker than recorded
 *
 * Opacity is a LEGIBILITY knob only and never encodes provenance. Selection and
 * hover brighten an element's OWN class colour and never swap hue, so
 * highlighting something can never make it read as a different class.
 */
import { Color } from "three";
import type { LayerId } from "./interiorScene";
import type { ProvenanceClass } from "./provenance";

export const PALETTE: Record<ProvenanceClass, { fill: string; edge: string; line: string }> = {
  observed: { fill: "#2f8f86", edge: "#123c39", line: "#35a89d" },
  user: { fill: "#c9852c", edge: "#4d3110", line: "#e0a04a" },
  // Inferred has no fill at all. Its line is E4's violet, darkened slightly
  // because Site Twin draws over a light sky/terrain rather than E4's dark
  // stage; the hue -- the thing that carries the class -- is unchanged.
  inferred: { fill: "", edge: "#9d3fbf", line: "#a847c9" },
};

/** E4 fill opacities: building fabric see-through so the electrical work reads. */
export const FILL_OPACITY: Partial<Record<string, number>> = {
  wall: 0.3,
  slab: 0.34,
  ceiling: 0.3,
  opening: 0.5,
  obstacle: 0.22,
};
export const DEFAULT_FILL_OPACITY = 0.95;

/* Precise mode is read mostly in plan, where the floor slab lies under
 * everything: the floor is made fainter and walls stronger so wall bands and
 * devices read. Same colours, same fill-or-dash rule; only legibility moves. */
export const PRECISE_FILL_OPACITY: Partial<Record<string, number>> = {
  wall: 0.55,
  slab: 0.1,
  ceiling: 0.06,
  opening: 0.5,
  obstacle: 0.2,
};

/** Pixels a conduit must span on screen before its cage / wires are drawn. */
export const CONDUIT_DETAIL_MIN_PX = 4;
export const WIRE_DETAIL_MIN_PX = 7;
export const NO_DEPTH_WRITE = new Set(["wall", "slab", "ceiling", "opening", "obstacle"]);

/** Picking priority: small electrical things beat the fabric around them. */
export const PICK_PRIORITY: Record<LayerId, number> = {
  devices: 0,
  equipment: 0,
  ports: 0,
  fittings: 0,
  routes: 1,
  conductors: 1,
  openings: 2,
  obstacles: 2,
  constraints: 2,
  spaces: 3,
  structure: 4,
};

export type Emphasis = "normal" | "hover" | "selected" | "dimmed";

/** Brighten or dim the element's own colour; the hue never changes. */
export function emphasise(hex: string, emphasis: Emphasis) {
  const color = new Color(hex);
  if (emphasis === "selected") color.offsetHSL(0, 0.15, 0.2);
  else if (emphasis === "hover") color.offsetHSL(0, 0.08, 0.1);
  return `#${color.getHexString()}`;
}

export function emphasisedOpacity(base: number, emphasis: Emphasis) {
  if (emphasis === "dimmed") return Math.max(base * 0.18, 0.07);
  if (emphasis === "selected") return Math.min(1, base * 1.9 + 0.12);
  if (emphasis === "hover") return Math.min(1, base * 1.35 + 0.05);
  return base;
}

/** Selection cage colour: a UI affordance outside the three class hues. */
export const SELECTION_CAGE = "#2b8ad8";
/** Site-context linework (GIS footprint): neutral, outside the class palette. */
export const SITE_CONTEXT_LINE = "#2f3634";
