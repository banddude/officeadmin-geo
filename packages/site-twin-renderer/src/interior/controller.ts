/*
 * controller.ts -- the loaded interior, its registration and the shared scene.
 *
 * One controller per loaded interior. It holds everything that does not change
 * while the user interacts (the parsed model, the registration and the
 * transform it implies) plus a cache of the built scene keyed by the one
 * drawing parameter that changes geometry. The overlay and the in-canvas layer
 * therefore look at the SAME scene object and address drawables by key.
 */
import { useMemo } from "react";
import type { Position, SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import type { BuildingModel } from "./canonical";
import { buildInteriorScene, type InteriorScene } from "./interiorScene";
import type { EntityVerdict } from "./provenance";
import {
  footprintContainment,
  registrationTransform,
  siteFrameOf,
  type FootprintCheck,
  type InteriorRegistration,
  type RegistrationTransform,
  type SiteFrame,
  type Vec3,
} from "./registration";
import type { BuildInfo } from "./renderStamp";
import { useInteriorState, type InteriorStore } from "./store";

export interface InteriorInput {
  model: BuildingModel;
  /** The exact bytes the model was parsed from, for the render stamp. */
  modelText: string;
  registration: InteriorRegistration | null;
  registrationVerdict: EntityVerdict | null;
  registrationText: string | null;
  /** Why a supplied registration was refused, if it was. */
  registrationErrors: string[];
}

export interface InteriorController {
  input: InteriorInput;
  store: InteriorStore;
  site: SemanticSiteModel;
  siteFrame: SiteFrame;
  transform: RegistrationTransform | null;
  footprint: Position[] | null;
  footprintCheck: FootprintCheck | null;
  generic: boolean;
  buildInfo: BuildInfo;
  sceneFor(minDrawnThicknessM: number): InteriorScene;
}

export function createInteriorController(args: {
  input: InteriorInput;
  store: InteriorStore;
  site: SemanticSiteModel;
  generic: boolean;
  buildInfo: BuildInfo;
}): InteriorController {
  const siteFrame = siteFrameOf(args.site);
  const transform = args.input.registration ? registrationTransform(args.input.registration, siteFrame) : null;
  const primary = args.site.geometry.buildings.find((b) => b.id === args.site.geometry.primaryBuildingId) ?? args.site.geometry.buildings[0];
  const footprint = primary?.polygon ?? null;
  const cache = new Map<number, InteriorScene>();
  const sceneFor = (minDrawn: number) => {
    let scene = cache.get(minDrawn);
    if (!scene) {
      scene = buildInteriorScene(args.input.model, { minDrawnThickness_m: minDrawn });
      cache.set(minDrawn, scene);
    }
    return scene;
  };
  // Plan points to test against the GIS footprint: wall ends and slab corners.
  let footprintCheck: FootprintCheck | null = null;
  if (transform && footprint) {
    const points: Vec3[] = [];
    for (const wall of args.input.model.walls ?? []) for (const p of wall.centerline.points) points.push([p.x, p.y, p.z]);
    for (const slab of args.input.model.slabs ?? []) for (const p of slab.footprint.points) points.push([p.x, p.y, p.z]);
    footprintCheck = footprintContainment(transform, footprint, siteFrame, points);
  }
  return { ...args, siteFrame, transform, footprint, footprintCheck, sceneFor };
}

/** The scene for the current drawing parameter; rebuilt only when it changes. */
export function useInteriorScene(controller: InteriorController) {
  const minDrawn = useInteriorState(controller.store, (s) => s.minDrawnThicknessM);
  return useMemo(() => controller.sceneFor(minDrawn), [controller, minDrawn]);
}
