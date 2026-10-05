import { describe, expect, it } from "vitest";
import { normalizeVisualObservation } from "./index";

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
});
