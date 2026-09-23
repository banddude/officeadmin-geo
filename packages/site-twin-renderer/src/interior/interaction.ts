/*
 * interaction.ts -- interaction state with no DOM and no WebGL, ported from
 * the E4 viewer (app/interaction.js).
 *
 * Every filter -- categories hidden, one category isolated, one level, one
 * element isolated -- composes through ONE predicate over drawables, so the
 * visible set is always the answer to one question and two filters can never
 * disagree about an element. Nothing here decides a provenance class, and
 * nothing here can change what a colour claims: hiding removes an element, it
 * never restyles one.
 */
import type { Drawable, InteriorScene, LayerId } from "./interiorScene";

export interface FilterState {
  categoriesOff: Partial<Record<LayerId, true>>;
  isolatedCategory: LayerId | null;
  isolatedKey: string | null;
  /** null means every level. */
  levelId: string | null;
  /** With a level isolated, keep elements the model places on no level. */
  showUnlevelled: boolean;
}

export function createFilterState(): FilterState {
  return { categoriesOff: {}, isolatedCategory: null, isolatedKey: null, levelId: null, showUnlevelled: true };
}

export interface Visibility { visible: boolean; reason: string }

export function visibilityOf(state: FilterState, drawable: Drawable): Visibility {
  if (state.isolatedKey) {
    return drawable.key === state.isolatedKey
      ? { visible: true, reason: "isolated element" }
      : { visible: false, reason: "another element is isolated" };
  }
  if (state.isolatedCategory && drawable.layer !== state.isolatedCategory) {
    return { visible: false, reason: `category ${state.isolatedCategory} is isolated` };
  }
  if (!state.isolatedCategory && state.categoriesOff[drawable.layer]) {
    return { visible: false, reason: `category ${drawable.layer} is switched off` };
  }
  if (state.levelId) {
    if (drawable.levelId === state.levelId) return { visible: true, reason: "on the selected level" };
    if (drawable.levelId === null) {
      return state.showUnlevelled
        ? { visible: true, reason: "the model places this element on no level; shown with every level" }
        : { visible: false, reason: "the model places this element on no level" };
    }
    return { visible: false, reason: "on another level" };
  }
  return { visible: true, reason: "no filter hides this" };
}

export function visibleKeys(state: FilterState, scene: InteriorScene) {
  return scene.drawables.filter((d) => visibilityOf(state, d).visible).map((d) => d.key).sort();
}

/* Mutators return a NEW state so a store can compare by reference. */

export function toggleCategory(state: FilterState, id: LayerId): FilterState {
  // Toggling always cancels a solo: the user asked for a mixed set.
  const categoriesOff = { ...state.categoriesOff };
  if (categoriesOff[id]) delete categoriesOff[id];
  else categoriesOff[id] = true;
  return { ...state, categoriesOff, isolatedCategory: null };
}

export function isolateCategory(state: FilterState, id: LayerId): FilterState {
  return { ...state, isolatedKey: null, isolatedCategory: state.isolatedCategory === id ? null : id };
}

export function isolateKey(state: FilterState, key: string | null): FilterState {
  return { ...state, isolatedKey: state.isolatedKey === key ? null : key };
}

export function setLevel(state: FilterState, levelId: string | null): FilterState {
  return { ...state, levelId };
}

export function showAll(): FilterState {
  return createFilterState();
}

/** A one-line account of what is on screen, in plain language. */
export function filterSummary(state: FilterState, scene: InteriorScene) {
  const parts: string[] = [];
  if (state.isolatedKey) {
    parts.push(`Showing one element only: ${scene.byKey[state.isolatedKey]?.displayName ?? state.isolatedKey}`);
  } else if (state.isolatedCategory) {
    const layer = scene.layers.find((l) => l.id === state.isolatedCategory);
    parts.push(`Showing only ${layer ? layer.customerLabel.toLowerCase() : state.isolatedCategory}`);
  } else {
    const off = (Object.keys(state.categoriesOff) as LayerId[])
      .map((id) => scene.layers.find((l) => l.id === id)?.customerLabel.toLowerCase() ?? id)
      .sort();
    if (off.length) parts.push(`Hiding ${off.join(", ")}`);
  }
  if (state.levelId) {
    const level = scene.levels.find((l) => l.id === state.levelId);
    parts.push(`Level: ${level ? level.name : state.levelId}`);
  }
  return parts.length ? `${parts.join(". ")}.` : "Showing the whole interior.";
}

export interface BrowseItem { key: string; name: string; kind: string; cls: Drawable["cls"]; levelId: string | null; visible: boolean }

/** The browsable index, grouped by category in canonical layer order. */
export function browseIndex(scene: InteriorScene, state: FilterState) {
  return scene.layers
    .map((layer) => {
      const items: BrowseItem[] = scene.drawables
        .filter((d) => d.layer === layer.id)
        .map((d) => ({ key: d.key, name: d.displayName, kind: d.kindCustomer, cls: d.cls, levelId: d.levelId, visible: visibilityOf(state, d).visible }));
      return { id: layer.id, label: layer.customerLabel, devLabel: layer.label, count: items.length, items };
    })
    .filter((group) => group.count > 0);
}

/* Ranked, not merely filtered: a flat substring match put a DOOR first for
 * "window" because every opening's kind word is "Door or window". Name
 * matches beat kind matches; ties break on scene order, so it is deterministic. */
const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_NAME = 2;
const RANK_KIND = 3;
const RANK_ID = 4;

export interface SearchHit { key: string; name: string; kind: string; cls: Drawable["cls"]; rank: number }

export function search(scene: InteriorScene, query: string, limit = 40): SearchHit[] {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ rank: number; index: number; item: SearchHit }> = [];
  scene.drawables.forEach((d, index) => {
    const name = d.displayName.toLowerCase();
    const kind = d.kindCustomer.toLowerCase();
    const id = d.entityId.toLowerCase();
    let rank = -1;
    if (name === needle) rank = RANK_EXACT;
    else if (name.startsWith(needle)) rank = RANK_PREFIX;
    else if (name.includes(needle)) rank = RANK_NAME;
    else if (kind.includes(needle)) rank = RANK_KIND;
    else if (id.includes(needle)) rank = RANK_ID;
    if (rank < 0) return;
    scored.push({ rank, index, item: { key: d.key, name: d.displayName, kind: d.kindCustomer, cls: d.cls, rank } });
  });
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.item);
}
