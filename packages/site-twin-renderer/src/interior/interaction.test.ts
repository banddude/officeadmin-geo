import { describe, expect, it } from "vitest";
import sample from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.json";
import type { BuildingModel } from "./canonical";
import { createFilterState, filterSummary, isolateCategory, isolateKey, search, setLevel, toggleCategory, visibilityOf, visibleKeys } from "./interaction";
import { buildInteriorScene } from "./interiorScene";
import { record, tinyModel } from "./testSupport";

const scene = buildInteriorScene(JSON.parse(JSON.stringify(sample)) as BuildingModel);

describe("interaction: filters compose through one predicate", () => {
  it("a level filter and a hidden category narrow together", () => {
    let state = setLevel(createFilterState(), "level:l2");
    state = toggleCategory(state, "structure");
    const visible = visibleKeys(state, scene);
    expect(visible).toContain("device:r4");
    expect(visible).not.toContain("device:r1"); // Level 1
    expect(visible).not.toContain("wall:l2-west"); // structure hidden
    expect(filterSummary(state, scene)).toBe("Hiding walls, floors & ceilings. Level: Sample Level 2.");
  });

  it("isolating a category or one element overrides the rest, and toggling cancels a solo", () => {
    let state = isolateCategory(createFilterState(), "routes");
    expect(visibleKeys(state, scene).every((key) => scene.byKey[key]!.layer === "routes")).toBe(true);
    state = toggleCategory(state, "devices");
    expect(state.isolatedCategory).toBeNull();
    state = isolateKey(state, "device:r1");
    expect(visibleKeys(state, scene)).toEqual(["device:r1"]);
  });

  it("a level filter keeps elements the model places on no level, and says why", () => {
    const model = tinyModel({ obstacles: [{ id: "obstacle:x", obstacle_type: "duct", geometry: { kind: "box3d", pose: { position: { x: 1, y: 1, z: 2 } }, size: { x: 1, y: 1, z: 1 } }, provenance: [record("observed")] }] });
    const tiny = buildInteriorScene(model);
    const state = setLevel(createFilterState(), "level:1");
    expect(visibilityOf(state, tiny.byKey["obstacle:x"]!)).toEqual({ visible: true, reason: "the model places this element on no level; shown with every level" });
    expect(visibilityOf({ ...state, showUnlevelled: false }, tiny.byKey["obstacle:x"]!).visible).toBe(false);
  });

  it("search ranks a name match above a kind-word match", () => {
    // Every opening's kind word is "Door or window"; the doors must not beat a window by name.
    const hits = search(scene, "window");
    expect(hits[0]!.name).toBe("Sample window A");
    expect(hits[1]!.name).toBe("Sample window B");
    expect(hits.slice(2).every((h) => h.rank > hits[1]!.rank)).toBe(true);
  });
});
