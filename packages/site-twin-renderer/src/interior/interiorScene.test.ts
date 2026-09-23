import { describe, expect, it } from "vitest";
import sample from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.json";
import type { BuildingModel } from "./canonical";
import { auditInteriorScene, buildInteriorScene } from "./interiorScene";
import { parseBuildingModel } from "./parseModel";
import { record, tinyElectricalModel, tinyModel } from "./testSupport";

function demoModel(): BuildingModel {
  const parsed = parseBuildingModel(JSON.parse(JSON.stringify(sample)));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.model;
}

describe("interior scene: canonical model -> drawables", () => {
  it("nothing inferred, placeholder or drawn-thicker emits a filled primitive (demo sample)", () => {
    const scene = buildInteriorScene(demoModel());
    expect(auditInteriorScene(scene)).toEqual([]);
    const filledButMayNotBe = scene.drawables.filter(
      (d) => (d.cls === "inferred" || d.basis === "viewer-placeholder" || d.substitutions.length) && d.prims.some((p) => p.type === "triangles"),
    );
    expect(filledButMayNotBe.map((d) => d.key)).toEqual([]);
  });

  it("the audit catches a filled inferred element", () => {
    const scene = buildInteriorScene(demoModel());
    const route = scene.drawables.find((d) => d.entityKind === "route")!;
    route.prims.push({ type: "triangles", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
    expect(auditInteriorScene(scene).join("\n")).toMatch(/emitted a filled primitive/);
  });

  it("forged observed provenance on a route still renders it unfilled and inferred", () => {
    const model = tinyElectricalModel();
    model.routes![0]!.provenance = [record("observed")];
    const route = buildInteriorScene(model).byKey["route:1"]!;
    expect(route.cls).toBe("inferred");
    expect(route.solidAllowed).toBe(false);
    expect(route.prims.every((p) => p.type === "lines")).toBe(true);
  });

  it("an element the model gives no size is a placeholder marker, not a box, whatever its class", () => {
    const model = tinyElectricalModel();
    delete model.electrical_devices![0]!.size;
    model.electrical_devices![0]!.provenance = [record("observed")];
    const device = buildInteriorScene(model).byKey["device:r"]!;
    expect(device.cls).toBe("observed");
    expect(device.basis).toBe("viewer-placeholder");
    expect(device.prims.map((p) => p.type)).toEqual(["lines"]);
  });

  it("resolves a riser's level through references, never by elevation", () => {
    // The C3 riser starts at the Level 1 panel and ends on a Level 2 receptacle;
    // most of its length and its end point are above the Level 2 floor.
    const scene = buildInteriorScene(demoModel());
    const riser = scene.byKey["route:c3-riser"]!;
    expect(riser.bounds.max[2]).toBeGreaterThan(3.2);
    expect(riser.levelId).toBe("level:l1");
    expect(riser.levelBasis).toBe("start_port_id -> owner_id -> level_id");
    // An element with no reference chain to a level has none.
    const model = tinyModel({ obstacles: [{ id: "obstacle:x", obstacle_type: "duct", geometry: { kind: "box3d", pose: { position: { x: 1, y: 1, z: 2 } }, size: { x: 1, y: 1, z: 1 } }, provenance: [record("observed")] }] });
    const unlevelled = buildInteriorScene(model);
    expect(unlevelled.byKey["obstacle:x"]!.levelId).toBeNull();
    expect(unlevelled.unlevelledKeys).toEqual(["obstacle:x"]);
  });

  it("wall geometry is exactly the canonical centerline, thickness and height", () => {
    const scene = buildInteriorScene(tinyModel());
    const south = scene.byKey["wall:s"]!;
    expect(south.bounds.min).toEqual([0, -0.1, 0]);
    expect(south.bounds.max).toEqual([4, 0.1, 2.7]);
    expect(south.substitutions).toEqual([]);
  });

  it("circuit membership reaches source, loads, routes, fittings and conductors", () => {
    const scene = buildInteriorScene(tinyElectricalModel());
    const circuit = scene.circuits[0]!;
    expect(new Set(circuit.memberKeys)).toEqual(new Set(["port:panel", "equipment:panel", "port:r", "device:r", "route:1", "fitting:1", "conductor:1"]));
    expect(scene.byKey["device:r"]!.circuitIds).toEqual(["circuit:1"]);
  });

  it("the demo sample is flagged synthetic and shows all three classes", () => {
    const scene = buildInteriorScene(demoModel());
    expect(scene.meta.synthetic).toBe(true);
    expect(scene.meta.notice).toMatch(/SYNTHETIC SAMPLE INTERIOR/);
    expect(scene.meta.classCounts.observed).toBeGreaterThan(0);
    expect(scene.meta.classCounts.user).toBeGreaterThan(0);
    expect(scene.meta.classCounts.inferred).toBeGreaterThan(0);
    // The scanned partition draws on two sources that disagree and resolves to inferred.
    const scanned = scene.byKey["wall:l1-partition-scanned"]!;
    expect(scanned.cls).toBe("inferred");
    expect(scanned.substitutions).toHaveLength(1);
  });
});
