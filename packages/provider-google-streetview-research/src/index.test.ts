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

import { parseGoogleStreetViewSearch } from "./index";

describe("parseGoogleStreetViewSearch", () => {
  it("attaches the current panorama date stored outside the historical timeline", () => {
    const current = [[2, "current-pano"], null, [[null, null, 34.1, -118.2], null, [10, 90, 0]]];
    const historical = [[2, "historical-pano"], null, [[null, null, 34.2, -118.3], null, [20, 90, 0]]];
    const subset: unknown[] = [];
    subset[3] = [[current, historical]];
    subset[8] = [[null, [2020, 12]]];
    const root: unknown[] = [];
    const response: unknown[] = [];
    response[1] = [null, "current-pano"];
    response[5] = [subset];
    response[6] = [null, null, null, null, null, null, null, [2022, 5]];
    root[1] = response;

    const parsed = parseGoogleStreetViewSearch(`callbackfunc(${JSON.stringify(root)})`);
    expect(parsed.find((pano) => pano.panoId === "current-pano")?.capturedAt).toBe("2022-05-01 00:00:00");
    expect(parsed.find((pano) => pano.panoId === "historical-pano")?.capturedAt).toBe("2020-12-01 00:00:00");
  });
});
