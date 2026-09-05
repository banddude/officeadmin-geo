import { describe, expect, it } from "vitest";
import { normalizeTargetHouseRegion, normalizeVisualObservation } from "./index";

describe("Ollama visual observation normalization", () => {
  it("normalizes stepped massing volumes", () => {
    const observation = normalizeVisualObservation("frame-a", {
      visible: true,
      confidence: 0.9,
      roof: { type: "flat" },
      massing: {
        storiesVisible: 3,
        stepped: true,
        confidence: 0.84,
        volumes: [
          { level: 0, widthFraction: 0.82, depthFraction: 0.9, horizontalCenter: 0.5, setback: "none", confidence: 0.9 },
          { level: 1, widthFraction: 0.7, depthFraction: 0.82, horizontalCenter: 0.52, setback: "slight", confidence: 0.8 },
          { level: 2, widthFraction: 0.6, depthFraction: 0.72, horizontalCenter: 0.5, setback: "moderate", confidence: 0.8 },
        ],
      },
      facades: [],
      site: {},
    });

    expect(observation.massing?.stepped).toBe(true);
    expect(observation.massing?.storiesVisible).toBe(3);
    expect(observation.massing?.volumes).toHaveLength(3);
    expect(observation.massing?.volumes[2]?.setback).toBe("moderate");
  });
  it("normalizes distinct facade components", () => {
    const observation = normalizeVisualObservation("frame-current", {
      visible: true,
      confidence: 0.93,
      roof: { type: "flat" },
      facadeComposition: {
        confidence: 0.9,
        components: [
          { kind: "volume", x: 0.2, width: 0.36, bottom: 0, top: 0.72, depthFraction: 0.7, setback: "slight", color: "wood", confidence: 0.9 },
          { kind: "tower", x: 0.52, width: 0.18, bottom: 0, top: 1, depthFraction: 0.62, setback: "none", color: "gray", material: "concrete", windowCount: 3, windowOrientation: "vertical", glazing: "medium", confidence: 0.95 },
          { kind: "balcony", x: 0.76, width: 0.32, bottom: 0.56, top: 0.64, depthFraction: 0.35, setback: "none", confidence: 0.8 },
        ],
      },
      facades: [],
      site: {},
    });

    expect(observation.facadeComposition?.components).toHaveLength(3);
    expect(observation.facadeComposition?.components[1]?.kind).toBe("tower");
    expect(observation.facadeComposition?.components[1]?.top).toBe(1);
    expect(observation.facadeComposition?.components[1]?.windowCount).toBe(3);
    expect(observation.facadeComposition?.components[1]?.windowOrientation).toBe("vertical");
    expect(observation.facadeComposition?.components[2]?.kind).toBe("balcony");
  });

  it("normalizes a localized target-building box without expanding into context", () => {
    const region = normalizeTargetHouseRegion({
      visible: true,
      confidence: 0.91,
      bbox: { left: 0.22, top: 0.14, right: 0.78, bottom: 0.86 },
    });

    expect(region).toEqual({
      visible: true,
      confidence: 0.91,
      x: 0.22,
      y: 0.14,
      width: 0.56,
      height: 0.72,
    });
  });

  it("fails localization closed when the returned box is implausibly tiny", () => {
    const region = normalizeTargetHouseRegion({
      visible: true,
      confidence: 0.99,
      bbox: { left: 0.5, top: 0.5, right: 0.53, bottom: 0.53 },
    });

    expect(region.visible).toBe(false);
  });

  it("accepts Gemma bboxes-array localization output", () => {
    const region = normalizeTargetHouseRegion({
      bboxes: [{ confidence: 0.95, bbox: [0.32, 0.46, 0.78, 0.91] }],
    });

    expect(region).toEqual({
      visible: true,
      confidence: 0.95,
      x: 0.32,
      y: 0.46,
      width: 0.46,
      height: 0.45,
    });
  });

});
