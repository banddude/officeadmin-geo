import { describe, expect, it } from "vitest";
import { computeRenderStamp, normaliseBuildInfo, sha256Hex } from "./renderStamp";

const CLEAN = normaliseBuildInfo({ commit: "e13dfe8a1b2c3d4e5f60718293a4b5c6d7e8f901", dirtyFiles: 0, source: "env" });
const NOW = new Date("2026-01-01T00:00:00Z");

describe("render stamp: every render says what produced it", () => {
  it("hashes exactly the bytes it is given", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("the render id is deterministic and changes with the model, registration and drawing parameter", async () => {
    const base = { build: CLEAN, modelText: '{"a":1}', registrationText: '{"r":1}', minDrawnThickness_m: 0.1143, now: NOW };
    const a = await computeRenderStamp(base);
    const again = await computeRenderStamp(base);
    expect(a.renderId).toMatch(/^[0-9a-f]{12}$/);
    expect(again.renderId).toBe(a.renderId);
    expect((await computeRenderStamp({ ...base, modelText: '{"a":2}' })).renderId).not.toBe(a.renderId);
    expect((await computeRenderStamp({ ...base, registrationText: '{"r":2}' })).renderId).not.toBe(a.renderId);
    expect((await computeRenderStamp({ ...base, minDrawnThickness_m: 0.1 })).renderId).not.toBe(a.renderId);
    expect(a.reproducible).toBe(true);
    expect(a.problem).toBeNull();
  });

  it("a dirty tree is never reported reproducible, and says how many paths were dirty", async () => {
    const stamp = await computeRenderStamp({ build: { ...CLEAN, dirtyFiles: 3 }, modelText: "{}", registrationText: null, minDrawnThickness_m: 0 });
    expect(stamp.reproducible).toBe(false);
    expect(stamp.problem).toMatch(/^UNREPRODUCIBLE RENDER: the working tree had 3 uncommitted paths/);
    const unknown = await computeRenderStamp({ build: { ...CLEAN, dirtyFiles: null }, modelText: "{}", registrationText: null, minDrawnThickness_m: 0 });
    expect(unknown.reproducible).toBe(false);
  });

  it("no commit means no build record, not a render id", async () => {
    const stamp = await computeRenderStamp({ build: normaliseBuildInfo({ commit: "not-a-sha", dirtyFiles: "0" }), modelText: "{}", registrationText: null, minDrawnThickness_m: 0 });
    expect(stamp.commit).toBeNull();
    expect(stamp.renderId).toBeNull();
    expect(stamp.problem).toMatch(/^No build record/);
  });

  it("reads the laptop's GIT_DIRTY_FILES string as a count", () => {
    expect(normaliseBuildInfo({ commit: "abcdef1", dirtyFiles: "2", source: "env" })).toEqual({ commit: "abcdef1", dirtyFiles: 2, source: "env" });
  });
});
