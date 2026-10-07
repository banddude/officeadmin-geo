import { assessFacadeComposition } from "./quality";
import type { SemanticSiteModel } from "./types";

/** A partial visual parse must not replace the measured building shell. */
export function buildingRepresentation(model: Pick<SemanticSiteModel, "facadeComposition" | "massing">): "composed" | "massing" | "measured" {
  const composition = model.facadeComposition;
  if (composition?.components.length) {
    const visible = composition.components.filter((component) => component.confidence >= 0.35);
    const primary = visible.filter((component) => component.kind === "volume" || component.kind === "tower");
    const finite = visible.every((component) =>
      [component.x, component.width, component.bottom, component.top, component.confidence].every(Number.isFinite)
      && component.width > 0 && component.top > component.bottom);
    // Until there is a supported-component graph, conservatively retain the
    // measured shell when primary visual masses start above its lowest floor.
    const grounded = primary.length > 0 && primary.every((component) => component.bottom <= 0.08);
    return finite && grounded && assessFacadeComposition({ ...composition, components: visible }).acceptable
      ? "composed" : "measured";
  }
  return model.massing?.volumes.length ? "massing" : "measured";
}

/** Never shorten a ground contact wall to make a hillside look less tall. */
export function terrainContactBottomY(topY: number, terrainY: number): number {
  return Math.min(topY - 0.05, terrainY - 0.05);
}
