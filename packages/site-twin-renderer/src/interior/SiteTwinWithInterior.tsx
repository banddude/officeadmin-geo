/*
 * SiteTwinWithInterior.tsx -- the exterior Site Twin with the canonical
 * interior mounted inside it.
 *
 * The exterior scene element is memoised on its own inputs only, so nothing
 * the interior does (hover, selection, filters, camera) re-renders the
 * exterior tree. The interior's state lives in an external store that the
 * in-canvas layer and the DOM overlay subscribe to directly.
 */
import { useMemo } from "react";
import type { SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { SiteTwinScene } from "../SiteTwinScene";
import { createInteriorController, type InteriorInput } from "./controller";
import { InteriorLayer } from "./InteriorLayer";
import { InteriorOverlay } from "./InteriorOverlay";
import type { BuildInfo } from "./renderStamp";
import { createInteriorStore, initialUiState, type InteriorUiState } from "./store";

export interface SiteTwinWithInteriorProps {
  site: SemanticSiteModel;
  /** The parsed canonical interior, or null to draw the exterior only. */
  interior: InteriorInput | null;
  /** Initial UI state (deep links). Read once. */
  initialState?: Partial<InteriorUiState>;
  buildInfo: BuildInfo;
  /** Generic-title mode: no identifying text is ever rendered. */
  generic?: boolean;
  debug?: boolean;
  view?: "facade" | "overview";
  className?: string;
}

export function SiteTwinWithInterior({ site, interior, initialState, buildInfo, generic = false, debug = false, view = "facade", className }: SiteTwinWithInteriorProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createInteriorStore(initialUiState(initialState)), []);
  const controller = useMemo(
    () => (interior ? createInteriorController({ input: interior, store, site, generic, buildInfo }) : null),
    [interior, store, site, generic, buildInfo],
  );
  const sceneElement = useMemo(
    () => (
      <SiteTwinScene model={site} debug={debug} view={view} className={className}>
        {controller ? <InteriorLayer controller={controller} /> : null}
      </SiteTwinScene>
    ),
    [site, debug, view, className, controller],
  );
  return (
    <>
      {sceneElement}
      {controller ? <InteriorOverlay controller={controller} /> : null}
    </>
  );
}
