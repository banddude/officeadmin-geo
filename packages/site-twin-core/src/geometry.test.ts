import { describe, expect, it } from "vitest";
import { angularDifferenceDegrees, bearingDegrees, haversineMeters, nearestFacadeEdgeIndex, rankStreetImages, selectDistinctStreetImages } from "./geometry";

const target = { latitude: 34.09962, longitude: -118.25278 };

describe("site twin geometry", () => {
  it("computes short local distances", () => {
    const distance = haversineMeters(target, { latitude: 34.10062, longitude: -118.25278 });
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });

  it("normalizes angular differences", () => {
    expect(angularDifferenceDegrees(350, 10)).toBe(20);
    expect(angularDifferenceDegrees(90, 270)).toBe(180);
  });

  it("ranks a close image facing the target above a farther image", () => {
    const close = { latitude: 34.0992, longitude: -118.25278, id: "close", provider: "test", imageUrl: "x" };
    const far = { latitude: 34.096, longitude: -118.25278, id: "far", provider: "test", imageUrl: "y" };
    const heading = bearingDegrees(close, target);
    const ranked = rankStreetImages([{ ...far, headingDeg: heading }, { ...close, headingDeg: heading }], target, 500);
    expect(ranked[0]?.id).toBe("close");
  });

  it("selects spatially distinct frames", () => {
    const candidates = rankStreetImages([
      { id: "a", provider: "test", imageUrl: "a", latitude: 34.0990, longitude: -118.25278 },
      { id: "b", provider: "test", imageUrl: "b", latitude: 34.09901, longitude: -118.25278 },
      { id: "c", provider: "test", imageUrl: "c", latitude: 34.0986, longitude: -118.25278 },
    ], target, 500);
    const selected = selectDistinctStreetImages(candidates, 2, 20);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((item) => item.id)).size).toBe(2);
  });

  it("selects the substantial footprint edge nearest the camera", () => {
    const polygon: [number, number][] = [
      [-118.0001, 34.0000],
      [-117.9999, 34.0000],
      [-117.9999, 34.0001],
      [-118.0001, 34.0001],
      [-118.0001, 34.0000],
    ];
    const southCamera = { latitude: 33.9998, longitude: -118.0 };
    expect(nearestFacadeEdgeIndex(polygon, southCamera)).toBe(0);
  });

});
