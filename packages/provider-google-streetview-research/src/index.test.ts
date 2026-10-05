import { describe, expect, it } from "vitest";
import { panoramaNormalizedX } from "./index";

describe("panoramaNormalizedX", () => {
  it("places the panorama's reported heading at the horizontal center", () => {
    expect(panoramaNormalizedX(15, 15)).toBeCloseTo(0.5, 8);
  });

  it("wraps a target heading across north correctly", () => {
    expect(panoramaNormalizedX(350, 10)).toBeCloseTo(160 / 360, 8);
  });

  it("places the opposite direction at the panorama seam", () => {
    expect(panoramaNormalizedX(190, 10)).toBeCloseTo(0, 8);
  });
});
