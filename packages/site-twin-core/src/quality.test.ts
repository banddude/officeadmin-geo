import { describe, expect, it } from "vitest";
import { assessFacadeComposition } from "./quality";

describe("facade composition quality", () => {
  it("rejects sparse high-confidence boxes that leave most of a facade missing", () => {
    const quality = assessFacadeComposition({
      confidence: 0.9,
      components: [
        { kind: "other", x: 0.3, width: 0.2, bottom: 0.4, top: 0.9, confidence: 0.9 },
        { kind: "tower", x: 0.7, width: 0.2, bottom: 0.4, top: 0.9, confidence: 0.9 },
      ],
    });
    expect(quality.acceptable).toBe(false);
    expect(quality.horizontalCoverage).toBeLessThan(0.3);
    expect(quality.reasons).toContain("left side of target facade is not reconstructed");
    expect(quality.structuralScore).toBeLessThan(0.7);
  });

  it("accepts a facade whose primary masses span the target and reach its roofline", () => {
    const quality = assessFacadeComposition({
      confidence: 0.9,
      components: [
        { kind: "volume", x: 0.18, width: 0.36, bottom: 0.04, top: 0.82, confidence: 0.9 },
        { kind: "tower", x: 0.5, width: 0.22, bottom: 0.04, top: 1, confidence: 0.92 },
        { kind: "volume", x: 0.79, width: 0.36, bottom: 0.04, top: 0.84, confidence: 0.88 },
      ],
    });
    expect(quality.acceptable).toBe(true);
    expect(quality.horizontalCoverage).toBeGreaterThan(0.8);
    expect(quality.maxTop).toBe(1);
    expect(quality.structuralScore).toBeGreaterThan(0.9);
  });

  it("does not let a balcony alone satisfy primary facade coverage", () => {
    const quality = assessFacadeComposition({
      confidence: 0.9,
      components: [
        { kind: "volume", x: 0.2, width: 0.32, bottom: 0.04, top: 0.75, confidence: 0.9 },
        { kind: "balcony", x: 0.62, width: 0.65, bottom: 0.5, top: 0.6, confidence: 0.9 },
      ],
    });
    expect(quality.acceptable).toBe(false);
    expect(quality.rightEdge).toBeLessThan(0.5);
  });
  it("rejects a tower label that swallows most of the facade", () => {
    const quality = assessFacadeComposition({
      confidence: 0.9,
      components: [
        { kind: "tower", x: 0.33, width: 0.66, bottom: 0.04, top: 1, confidence: 0.9 },
        { kind: "volume", x: 0.83, width: 0.34, bottom: 0.04, top: 0.82, confidence: 0.9 },
      ],
    });
    expect(quality.acceptable).toBe(false);
    expect(quality.reasons).toContain("tower occupies implausibly large facade width");
  });

  it("scores a richer full-width architectural parse above a two-box parse", () => {
    const coarse = assessFacadeComposition({
      confidence: 0.9,
      components: [
        { kind: "tower", x: 0.25, width: 0.5, bottom: 0.04, top: 1, color: "gray", material: "concrete", confidence: 0.9 },
        { kind: "volume", x: 0.75, width: 0.5, bottom: 0.04, top: 0.82, color: "beige", material: "stucco", confidence: 0.9 },
      ],
    });
    const detailed = assessFacadeComposition({
      confidence: 0.88,
      components: [
        { kind: "volume", x: 0.16, width: 0.32, bottom: 0.04, top: 0.82, color: "wood", material: "wood/glass", confidence: 0.86 },
        { kind: "tower", x: 0.5, width: 0.2, bottom: 0.04, top: 1, color: "gray", material: "concrete", confidence: 0.9 },
        { kind: "volume", x: 0.8, width: 0.4, bottom: 0.04, top: 0.82, color: "white", material: "stucco", confidence: 0.86 },
      ],
    });
    expect(coarse.acceptable).toBe(true);
    expect(detailed.acceptable).toBe(true);
    expect(detailed.structuralScore).toBeGreaterThan(coarse.structuralScore);
  });

});
