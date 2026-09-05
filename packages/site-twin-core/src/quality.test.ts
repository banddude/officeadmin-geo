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
});
