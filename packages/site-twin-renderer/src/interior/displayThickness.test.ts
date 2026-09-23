import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_DRAWN_THICKNESS_M,
  MIN_DRAWN_THICKNESS_OPTIONS,
  substituteThickness,
} from "./displayThickness";
import { buildInteriorScene } from "./interiorScene";
import { clone, deepFreeze, record, tinyModel } from "./testSupport";

/** Width of a drawn wall = spread of its vertices across the wall direction. */
function drawnWidthAcrossY(positions: number[]) {
  const ys = positions.filter((_, i) => i % 3 === 1);
  return Math.max(...ys) - Math.min(...ys);
}

describe("display thickness (issue #88): a rendering parameter, never a model claim", () => {
  it("substitutes a 0.001 m RoomPlan wall with the labelled minimum and records both values", () => {
    const swap = substituteThickness("wall", 0.001, 0.1143);
    expect(swap).not.toBeNull();
    expect(swap!.recorded_m).toBe(0.001);
    expect(swap!.drawn_m).toBe(0.1143);
    expect(swap!.why).toMatch(/not a measurement/);
  });

  it("draws a wall at its recorded thickness when it is already thick enough", () => {
    expect(substituteThickness("wall", 0.2, 0.1143)).toBeNull();
    expect(substituteThickness("wall", 0.1143, 0.1143)).toBeNull();
  });

  it("0 turns substitution off entirely", () => {
    expect(substituteThickness("wall", 0.001, 0)).toBeNull();
    const scene = buildInteriorScene(roomPlanWallModel(), { minDrawnThickness_m: 0 });
    expect(scene.meta.substitutionCount).toBe(0);
    const wall = scene.byKey["wall:scanned"]!;
    expect(drawnWidthAcrossY(wall.prims[0]!.positions)).toBeCloseTo(0.001, 9);
  });

  it("never substitutes an opening, device or equipment dimension", () => {
    for (const kind of ["opening", "electrical_device", "electrical_equipment", "obstacle", "space"] as const) {
      expect(substituteThickness(kind, 0.001, 0.1143), kind).toBeNull();
    }
  });

  it("defaults to 4.5 in (0.1143 m), the floor-plan editor's unscanned-wall default, and offers it as a labelled choice", () => {
    expect(DEFAULT_MIN_DRAWN_THICKNESS_M).toBeCloseTo(0.1143, 10);
    const scene = buildInteriorScene(roomPlanWallModel());
    expect(scene.meta.displaySettings.minDrawnThickness_m).toBeCloseTo(0.1143, 10);
    expect(MIN_DRAWN_THICKNESS_OPTIONS.some((o) => o.value === DEFAULT_MIN_DRAWN_THICKNESS_M && /4\.5 in/.test(o.label))).toBe(true);
  });

  it("the drawn thickness never flows back into the model", () => {
    const model = deepFreeze(roomPlanWallModel());
    const before = clone(model);
    const scene = buildInteriorScene(model, { minDrawnThickness_m: 0.1143 });
    expect(model).toEqual(before);
    const wall = scene.byKey["wall:scanned"]!;
    expect((wall.entity as unknown as { thickness_m: number }).thickness_m).toBe(0.001);
    // ...while the picture really is drawn at the parameter.
    expect(drawnWidthAcrossY(wall.prims[0]!.positions)).toBeCloseTo(0.1143, 9);
    expect(wall.substitutions).toEqual([expect.objectContaining({ field: "thickness_m", recorded_m: 0.001, drawn_m: 0.1143 })]);
  });

  it("a substituted wall is never drawn filled, even when every record says observed", () => {
    const model = roomPlanWallModel();
    model.walls![0]!.provenance = [record("observed")];
    const scene = buildInteriorScene(model);
    const wall = scene.byKey["wall:scanned"]!;
    expect(wall.cls).toBe("observed");
    expect(wall.solidAllowed).toBe(false);
    expect(wall.prims.map((p) => p.type)).toEqual(["lines"]);
    // The thick wall beside it, with the same class, is filled.
    expect(scene.byKey["wall:thick"]!.prims.map((p) => p.type)).toEqual(["triangles", "lines"]);
  });

  it("the scene reports the parameter and exactly which elements it changed", () => {
    const scene = buildInteriorScene(roomPlanWallModel(), { minDrawnThickness_m: 0.05 });
    expect(scene.meta.displaySettings.minDrawnThickness_m).toBe(0.05);
    expect(scene.meta.substitutionCount).toBe(1);
    expect(scene.meta.substitutedKeys).toEqual(["wall:scanned"]);
  });
});

function roomPlanWallModel() {
  return tinyModel({
    walls: [
      {
        id: "wall:scanned", level_id: "level:1", thickness_m: 0.001, height_m: 2.7,
        centerline: { kind: "polyline3d", points: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] },
        provenance: [record("observed", { method: "wall surface from a scan" }), record("inferred", { method: "thickness not captured; 0.001 m recorded" })],
      },
      {
        id: "wall:thick", level_id: "level:1", thickness_m: 0.2, height_m: 2.7,
        centerline: { kind: "polyline3d", points: [{ x: 0, y: 3, z: 0 }, { x: 4, y: 3, z: 0 }] },
        provenance: [record("observed")],
      },
    ],
  });
}
