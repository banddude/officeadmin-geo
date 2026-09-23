import { describe, expect, it } from "vitest";
import sample from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.json";
import type { BuildingModel } from "./canonical";
import { buildInteriorScene } from "./interiorScene";
import { feetInches, mountingHeight, routeDimensions } from "./precise";

const scene = buildInteriorScene(JSON.parse(JSON.stringify(sample)) as BuildingModel);

describe("precise mode numbers come straight from canonical coordinates", () => {
  it("mounting height is pose z above the level its references reach", () => {
    // R4 is on Level 2 (elevation 3.2 m) with its centre at z = 3.65 m.
    const r4 = mountingHeight(scene.byKey["device:r4"]!, scene)!;
    expect(r4.levelId).toBe("level:l2");
    expect(r4.centerAff).toBeCloseTo(0.45, 9);
    expect(r4.bottomAff).toBeCloseTo(0.39, 9);
    expect(r4.topAff).toBeCloseTo(0.51, 9);
    const panel = mountingHeight(scene.byKey["equipment:panel-p1"]!, scene)!;
    expect(panel.bottomAff).toBeCloseTo(1.1, 9);
    expect(panel.topAff).toBeCloseTo(1.9, 9);
  });

  it("a sizeless element reports its centre height but invents no top or bottom", () => {
    const j1 = mountingHeight(scene.byKey["device:j1"]!, scene)!;
    expect(j1.centerAff).toBeCloseTo(2.9, 9);
    expect(j1.hasSize).toBe(false);
    expect(j1.bottomAff).toBeNull();
    expect(j1.topAff).toBeNull();
  });

  it("formats feet and inches to the nearest eighth", () => {
    expect(feetInches(0.4572)).toBe(`1'-6"`);
    expect(feetInches(0.45)).toBe(`1'-5 3/4"`);
    expect(feetInches(1.2)).toBe(`3'-11 1/4"`);
    expect(feetInches(0.1143)).toBe(`0'-4 1/2"`);
    expect(feetInches(-0.3048)).toBe(`-1'-0"`);
  });

  it("route segment lengths and total come from the canonical centerline", () => {
    const route = routeDimensions(scene.byKey["route:c1-r2"]!, scene)!;
    expect(route.segments.map((s) => Number(s.lengthM.toFixed(6)))).toEqual([1.5, 1.6, 2.39]);
    expect(route.totalM).toBeCloseTo(5.49, 9);
    expect(route.segments.map((s) => s.vertical)).toEqual([false, false, true]);
    expect(route.vertices.map((v) => v.aff)).toEqual([2.9, 2.9, 2.9, 0.51]);
  });
});
