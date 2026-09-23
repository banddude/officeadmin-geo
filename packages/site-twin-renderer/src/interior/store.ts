/*
 * store.ts -- the interior view's UI state, in a tiny external store.
 *
 * Why not React state in a parent: the exterior renderer is one large
 * component tree that rebuilds geometry when it re-renders. Interior state
 * (hover especially) changes at pointer rate, so it must never live above
 * <SiteTwinScene>. The DOM overlay and the in-canvas layer both subscribe here
 * directly; the component that mounts the scene never does.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_MIN_DRAWN_THICKNESS_M } from "./displayThickness";
import { createFilterState, type FilterState } from "./interaction";

export type InteriorMode = "off" | "cutaway" | "precise";
export type PreciseView = "plan" | "front" | "side" | "iso";

export interface InteriorUiState {
  mode: InteriorMode;
  /** Height of the cutaway plane above the active level's floor, metres. */
  cutHeightM: number;
  /** The labelled display-thickness parameter (issue #88). */
  minDrawnThicknessM: number;
  filter: FilterState;
  selectedKey: string | null;
  hoverKey: string | null;
  circuitId: string | null;
  preciseView: PreciseView;
  showLabels: boolean;
  searchText: string;
  /** Bumped to ask the camera to frame the visible interior again. */
  frameRequest: number;
  /** Bumped to ask the camera to zoom to the selection. */
  focusRequest: number;
  /** Which of the two requests the camera last honoured. */
  cameraIntent: "frame" | "focus";
  /** Pixels of canvas covered by the overlay panels, so framing centres in the rest. */
  insets: { left: number; right: number };
  /** Written by the canvas for the overlay's scale bar and compass. */
  viewport: { metresPerPixel: number | null; northDeg: number | null; orthographic: boolean };
}

/** The cutaway height default: the architectural plan-cut convention. */
export const DEFAULT_CUT_HEIGHT_M = 1.2;

export function initialUiState(overrides: Partial<InteriorUiState> = {}): InteriorUiState {
  return {
    mode: "cutaway",
    cutHeightM: DEFAULT_CUT_HEIGHT_M,
    minDrawnThicknessM: DEFAULT_MIN_DRAWN_THICKNESS_M,
    filter: createFilterState(),
    selectedKey: null,
    hoverKey: null,
    circuitId: null,
    preciseView: "plan",
    showLabels: true,
    searchText: "",
    frameRequest: 0,
    focusRequest: 0,
    cameraIntent: "frame",
    insets: { left: 0, right: 0 },
    viewport: { metresPerPixel: null, northDeg: null, orthographic: false },
    ...overrides,
  };
}

export interface InteriorStore {
  get(): InteriorUiState;
  set(update: Partial<InteriorUiState> | ((state: InteriorUiState) => Partial<InteriorUiState>)): void;
  subscribe(listener: () => void): () => void;
}

export function createInteriorStore(initial: InteriorUiState): InteriorStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === "function" ? update(state) : update;
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof InteriorUiState>) {
        if (!Object.is(state[key], patch[key])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useInteriorState<T>(store: InteriorStore, selector: (state: InteriorUiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
