import { describe, expect, it } from "vitest";
import sample from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.json";
import { parseBuildingModel } from "./parseModel";
import { clone, tinyElectricalModel } from "./testSupport";

function errorsOf(input: unknown) {
  const result = parseBuildingModel(input);
  if (result.ok) throw new Error("expected the document to be refused");
  return result.errors;
}

describe("parseBuildingModel refuses rather than reinterprets", () => {
  it("accepts the synthetic demo interior and a minimal electrical model", () => {
    expect(parseBuildingModel(clone(sample))).toMatchObject({ ok: true });
    expect(parseBuildingModel(tinyElectricalModel())).toMatchObject({ ok: true });
  });

  it("refuses a schema_version it does not read", () => {
    const doc = { ...tinyElectricalModel(), schema_version: "2.0.0" };
    expect(errorsOf(doc)).toEqual([expect.stringMatching(/^\$\.schema_version: .*will not reinterpret "2\.0\.0"/)]);
  });

  it("refuses non-canonical units and axes", () => {
    const doc = tinyElectricalModel() as unknown as Record<string, Record<string, unknown>>;
    doc.coordinate_system = { ...doc.coordinate_system, length_unit: "ft", up_axis: "+Y" };
    const errors = errorsOf(doc);
    expect(errors).toContain('$.coordinate_system.length_unit: must be "m", got "ft"');
    expect(errors).toContain('$.coordinate_system.up_axis: must be "+Z", got "+Y"');
  });

  it("refuses dangling level and host references", () => {
    const doc = tinyElectricalModel();
    doc.walls![1]!.level_id = "level:nowhere";
    doc.electrical_devices![0]!.host_id = "wall:nowhere";
    const errors = errorsOf(doc);
    expect(errors).toContain('$.walls[1].level_id: references missing level "level:nowhere"');
    expect(errors).toContain('$.electrical_devices[0].host_id: references missing entity "wall:nowhere"');
  });

  it("refuses a route that does not start on its start port", () => {
    const doc = tinyElectricalModel();
    doc.routes![0]!.centerline.points[0] = { x: 0.1, y: 1.5, z: 1.8 };
    expect(errorsOf(doc)).toEqual(["$.routes[0].centerline: must start at the start port position"]);
  });

  it("refuses duplicate ids", () => {
    const doc = tinyElectricalModel();
    doc.walls![2]!.id = "wall:s";
    expect(errorsOf(doc)).toContain('$.walls[2].id: duplicate entity id "wall:s"');
  });

  it("refuses fields the contract does not define", () => {
    const doc = tinyElectricalModel() as unknown as { walls: Array<Record<string, unknown>> };
    doc.walls[0]!.display_thickness_m = 0.1143;
    expect(errorsOf(doc)).toEqual(["$.walls[0].display_thickness_m: is not a field of the canonical contract"]);
  });

  it("refuses a derivation outside the contract's enum", () => {
    const doc = tinyElectricalModel() as unknown as { walls: Array<{ provenance: Array<Record<string, unknown>> }> };
    doc.walls[0]!.provenance[0]!.derivation = "designed";
    expect(errorsOf(doc)).toEqual(['$.walls[0].provenance[0].derivation: must be "observed", "user", "inferred" or null, got "designed"']);
  });

  it("refuses a rotation that is not a normalized quaternion", () => {
    const doc = tinyElectricalModel();
    doc.electrical_devices![0]!.pose.rotation = { w: 1, x: 0, y: 0, z: 1 };
    expect(errorsOf(doc)).toEqual([expect.stringMatching(/^\$\.electrical_devices\[0\]\.pose\.rotation: must be a normalized quaternion/)]);
  });

  it("refuses a non-positive thickness", () => {
    const doc = tinyElectricalModel();
    doc.walls![0]!.thickness_m = 0;
    expect(errorsOf(doc)).toEqual(["$.walls[0].thickness_m: must be greater than 0"]);
  });
});
