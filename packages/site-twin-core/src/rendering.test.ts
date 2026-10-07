import { describe, expect, it } from "vitest";
import { buildingRepresentation, terrainContactBottomY } from "./rendering";
import type { SemanticSiteModel } from "./types";

function model(components: NonNullable<SemanticSiteModel["facadeComposition"]>["components"]) {
  return { facadeComposition: { components, confidence: 0.9, sourceImageIds: ["synthetic"] },
    massing: { storiesVisible: 2, stepped: true, volumes: [{ level: 0, widthFraction: 1, horizontalCenter: 0.5, confidence: 0.9 }], confidence: 0.9, sourceImageIds: ["synthetic"] } };
}

describe("grounded render selection", () => {
  it("does not replace a measured building with two floating high-confidence fragments", () => {
    const input = model([
      { kind: "tower", x: 0.7, width: 0.2, bottom: 0.4, top: 0.9, confidence: 0.85 },
      { kind: "other", x: 0.3, width: 0.2, bottom: 0.4, top: 0.9, confidence: 0.85 },
    ]);
    const before = JSON.stringify(input);
    expect(buildingRepresentation(input)).toBe("measured");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("rejects full-width masses with no ground-floor support", () => {
    expect(buildingRepresentation(model([{ kind: "volume", x: 0.5, width: 1, bottom: 0.4, top: 1, confidence: 0.9 }]))).toBe("measured");
  });
  it("retains complete grounded visual geometry", () => {
    expect(buildingRepresentation(model([{ kind: "volume", x: 0.5, width: 1, bottom: 0.04, top: 1, confidence: 0.9 }]))).toBe("composed");
  });
  it("does not use low-confidence components to fill the missing facade", () => {
    expect(buildingRepresentation(model([
      { kind: "volume", x: 0.5, width: 1, bottom: 0, top: 1, confidence: 0.1 },
      { kind: "tower", x: 0.7, width: 0.2, bottom: 0.04, top: 0.9, confidence: 0.9 },
    ]))).toBe("measured");
  });
  it("fails closed for nonfinite geometry", () => {
    expect(buildingRepresentation(model([{ kind: "volume", x: NaN, width: 1, bottom: 0, top: 1, confidence: 0.9 }]))).toBe("measured");
  });
  it.each([
    { bottom: -0.5 }, { top: 1.5 }, { width: 3 }, { x: -1 }, { confidence: 2 },
  ])("rejects out-of-range normalized geometry %j", (invalid) => {
    expect(buildingRepresentation(model([{ kind: "volume", x: 0.5, width: 1, bottom: 0, top: 1, confidence: 0.9, ...invalid }]))).toBe("measured");
  });
  it("keeps the existing massing fallback when no composition was supplied", () => {
    const input = model([]);
    expect(buildingRepresentation(input)).toBe("massing");
    expect(buildingRepresentation({})).toBe("measured");
  });
});

describe("terrain contact", () => {
  it.each([0, 3, 9.9, 12])("reaches terrain at elevation %s without an exposed-height cap", (terrainY) => {
    const bottom = terrainContactBottomY(10, terrainY);
    expect(bottom).toBeLessThan(terrainY);
    expect(bottom).toBeLessThan(10);
  });
  it("does not leave a tall foundation suspended over downhill terrain", () => {
    expect(terrainContactBottomY(18, 4)).toBeCloseTo(3.95);
  });
});
