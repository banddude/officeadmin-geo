import { describe, expect, it } from "vitest";
import { fuseSiteModel } from "./fusion";
import type { SiteGeometry, StreetImageCandidate, VisualObservation } from "./types";

const geometry: SiteGeometry = {
  center: { latitude: 34.09962, longitude: -118.25278 },
  buildings: [{
    id: "building",
    polygon: [[-118.2528, 34.0996], [-118.2527, 34.0996], [-118.2527, 34.0997], [-118.2528, 34.0997], [-118.2528, 34.0996]],
    heightM: 9,
    provenance: { provider: "test" },
  }],
  primaryBuildingId: "building",
  roads: [],
  sidewalks: [],
  terrain: [],
  groundCover: [],
  provenance: [],
};

const imagery: StreetImageCandidate[] = [
  { id: "a", provider: "test", latitude: 34.099, longitude: -118.252, imageUrl: "a", score: 0.9 },
  { id: "b", provider: "test", latitude: 34.099, longitude: -118.253, imageUrl: "b", score: 0.8 },
];

const observations: VisualObservation[] = [
  {
    sourceImageId: "a",
    visible: true,
    confidence: 0.95,
    storiesApprox: 2,
    roof: { type: "flat", color: "dark gray", rooftopDeck: true },
    massing: {
      storiesVisible: 3,
      stepped: true,
      confidence: 0.92,
      volumes: [
        { level: 0, widthFraction: 0.8, depthFraction: 0.9, horizontalCenter: 0.5, setback: "none", confidence: 0.9 },
        { level: 1, widthFraction: 0.7, depthFraction: 0.82, horizontalCenter: 0.5, setback: "slight", confidence: 0.9 },
        { level: 2, widthFraction: 0.62, depthFraction: 0.74, horizontalCenter: 0.5, setback: "moderate", confidence: 0.9 },
      ],
    },
    facades: [{
      wall: "front",
      confidence: 0.9,
      colors: ["white", "wood"],
      materials: ["stucco", "wood"],
      windows: [{ x: 0.2, y: 0.55, width: 0.25, height: 0.2, confidence: 0.9 }],
      doors: [{ x: 0.72, y: 0, width: 0.12, height: 0.32, confidence: 0.9, material: "wood" }],
    }],
    site: { stairs: true, trees: true },
  },
  {
    sourceImageId: "b",
    visible: true,
    confidence: 0.8,
    storiesApprox: 2,
    roof: { type: "flat", color: "gray" },
    facades: [{
      wall: "front",
      confidence: 0.75,
      colors: ["white"],
      materials: ["stucco"],
      windows: [{ x: 0.22, y: 0.56, width: 0.24, height: 0.19, confidence: 0.8 }],
      doors: [],
    }],
    site: { stairs: false, trees: false },
  },
];

describe("site twin fusion", () => {
  it("keeps the strongest repeated roof fact", () => {
    const model = fuseSiteModel("test", geometry, imagery, observations);
    expect(model.roof.value.type).toBe("flat");
    expect(model.roof.confidence).toBeGreaterThan(0.8);
  });

  it("clusters repeated facade openings", () => {
    const model = fuseSiteModel("test", geometry, imagery, observations);
    const front = model.facades.find((facade) => facade.wall === "front");
    expect(front?.windows).toHaveLength(1);
    expect(front?.windows[0]?.x).toBeGreaterThan(0.19);
    expect(front?.windows[0]?.x).toBeLessThan(0.23);
  });

  it("treats positive site evidence as stronger than absence", () => {
    const model = fuseSiteModel("test", geometry, imagery, observations);
    expect(model.site.stairs.value).toBe(true);
    expect(model.site.trees.value).toBe(true);
  });

  it("treats missing boolean evidence as unknown-confidence false rather than true", () => {
    const model = fuseSiteModel("Test", geometry, [], []);
    expect(model.site.driveway.value).toBe(false);
    expect(model.site.driveway.confidence).toBe(0);
    expect(model.site.retainingWalls.value).toBe(false);
    expect(model.site.fence.value).toBe(false);
  });

  it("preserves the strongest stepped massing observation", () => {
    const model = fuseSiteModel("test", geometry, imagery, observations);
    expect(model.massing?.stepped).toBe(true);
    expect(model.massing?.storiesVisible).toBe(3);
    expect(model.massing?.volumes).toHaveLength(3);
    expect(model.massing?.volumes[2]?.setback).toBe("moderate");
  });

});
