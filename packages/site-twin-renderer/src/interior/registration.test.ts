import { describe, expect, it } from "vitest";
import type { SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import site from "../../../../apps/site-twin-demo/public/site-twin.json";
import demoRegistration from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.registration.json";
import sample from "../../../../apps/site-twin-demo/public/interior/synthetic-interior.json";
import {
  canonicalToWorld,
  footprintContainment,
  latLonFromLocal,
  linearDeterminant,
  parseRegistration,
  registrationTransform,
  siteFrameOf,
  type InteriorRegistration,
  type SiteFrame,
  type Vec3,
} from "./registration";
import { clone, record } from "./testSupport";

const FRAME: SiteFrame = { center: { latitude: 34, longitude: -118 }, verticalDatumM: 100 };

function registration(overrides: Partial<InteriorRegistration> = {}): InteriorRegistration {
  return {
    registration_version: "1",
    id: "registration:test",
    interior: { model_id: "test:tiny", frame_id: "test-frame" },
    anchor: { ...FRAME.center },
    elevation_m: 100,
    rotation_rad: 0,
    provenance: [record("user")],
    ...overrides,
  };
}

function close(actual: Vec3, expected: Vec3) {
  actual.forEach((value, i) => expect(value, `axis ${i}`).toBeCloseTo(expected[i]!, 6));
}

describe("registration: an explicit, provenance-carrying placement of the interior on the site", () => {
  it("maps canonical +Z to site up, measured from the base elevation above the site datum", () => {
    const t = registrationTransform(registration({ elevation_m: 164.1 }), FRAME);
    close(canonicalToWorld(t, [0, 0, 0]), [0, 64.1, 0]);
    close(canonicalToWorld(t, [0, 0, 2.5]), [0, 66.6, 0]);
  });

  it("maps canonical +X to east and +Y to north at zero rotation (site Z points south)", () => {
    const t = registrationTransform(registration(), FRAME);
    close(canonicalToWorld(t, [1, 0, 0]), [1, 0, 0]);
    close(canonicalToWorld(t, [0, 1, 0]), [0, 0, -1]);
  });

  it("rotates counter-clockwise from east as seen from above", () => {
    const t = registrationTransform(registration({ rotation_rad: Math.PI / 2 }), FRAME);
    close(canonicalToWorld(t, [1, 0, 0]), [0, 0, -1]); // +X now points north
    close(canonicalToWorld(t, [0, 1, 0]), [-1, 0, 0]); // +Y now points west
    const t30 = registrationTransform(registration({ rotation_rad: -Math.PI / 6 }), FRAME);
    close(canonicalToWorld(t30, [2, 0, 0]), [2 * Math.cos(-Math.PI / 6), 0, -2 * Math.sin(-Math.PI / 6)]);
  });

  it("never mirrors: the placement is a proper rotation (determinant +1) at any angle", () => {
    for (const angle of [0, 0.3, -0.5235987755982988, Math.PI / 2, 2.5, -3]) {
      expect(linearDeterminant(registrationTransform(registration({ rotation_rad: angle }), FRAME).matrix)).toBeCloseTo(1, 12);
    }
  });

  it("places the interior origin at the anchor's local offset from the site centre", () => {
    const anchor = latLonFromLocal(FRAME, -5.5, -1.1);
    const t = registrationTransform(registration({ anchor }), FRAME);
    // Through the matrix that actually places geometry, not only the summary fields.
    close(canonicalToWorld(t, [0, 0, 0]), [-5.5, 0, 1.1]);
    close(canonicalToWorld(t, [2, 1, 0]), [-3.5, 0, 0.1]);
    expect(t.anchorEastM).toBeCloseTo(-5.5, 6);
    expect(t.anchorNorthM).toBeCloseTo(-1.1, 6);
    close(t.originWorld, canonicalToWorld(t, [0, 0, 0]));
  });

  it("a person-chosen registration is user; one nobody vouches for fails closed to inferred", () => {
    const chosen = parseRegistration(registration(), { model_id: "test:tiny", frame_id: "test-frame" });
    expect(chosen.ok && chosen.verdict.cls).toBe("user");
    const unsourced = parseRegistration(registration({ provenance: [] }), { model_id: "test:tiny", frame_id: "test-frame" });
    expect(unsourced.ok && unsourced.verdict.cls).toBe("inferred");
    const fitted = parseRegistration(registration({ provenance: [record("inferred")] }));
    expect(fitted.ok && fitted.verdict.cls).toBe("inferred");
  });

  it("refuses a registration made for a different interior", () => {
    const result = parseRegistration(registration(), { model_id: "test:other", frame_id: "test-frame" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/made for test:tiny .* not for test:other .* refused/);
  });

  it("refuses a registration with no rotation rather than assuming zero", () => {
    const doc = clone(registration()) as unknown as Record<string, unknown>;
    delete doc.rotation_rad;
    const result = parseRegistration(doc);
    expect(!result.ok && result.errors).toEqual(["$.rotation_rad: must be a finite number (radians)"]);
  });

  it("reports how far the registered interior strays outside the footprint", () => {
    const t = registrationTransform(registration(), FRAME);
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([e, n]) => {
      const ll = latLonFromLocal(FRAME, e!, n!);
      return [ll.longitude, ll.latitude] as [number, number];
    });
    const inside = footprintContainment(t, square, FRAME, [[1, 1, 0], [9, 9, 0]]);
    expect(inside).toEqual({ checkedPoints: 2, outsidePoints: 0, maxOutsideM: 0 });
    const outside = footprintContainment(t, square, FRAME, [[1, 1, 0], [12, 5, 0]]);
    expect(outside.outsidePoints).toBe(1);
    expect(outside.maxOutsideM).toBeCloseTo(2, 3);
  });

  it("uses the lowest terrain sample as the vertical datum, as the exterior renderer does", () => {
    const frame = siteFrameOf(site as unknown as SemanticSiteModel);
    const lowest = Math.min(...(site as unknown as SemanticSiteModel).geometry.terrain.map((s) => s.elevationM));
    expect(frame.verticalDatumM).toBe(lowest);
    expect(siteFrameOf({ center: FRAME.center, geometry: { terrain: [] } } as unknown as SemanticSiteModel).verticalDatumM).toBe(0);
  });

  it("the demo registration is a user placement that keeps every synthetic wall inside the demo footprint", () => {
    const parsed = parseRegistration(clone(demoRegistration), { model_id: sample.model_id, frame_id: sample.coordinate_system.frame_id });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.verdict.cls).toBe("user");
    const siteModel = site as unknown as SemanticSiteModel;
    const frame = siteFrameOf(siteModel);
    const t = registrationTransform(parsed.registration, frame);
    const building = siteModel.geometry.buildings.find((b) => b.id === siteModel.geometry.primaryBuildingId)!;
    // Outer faces of the 0.2 m exterior walls of the 8 x 7 m synthetic plan.
    const corners: Vec3[] = [[-0.1, -0.1, 0], [8.1, -0.1, 0], [8.1, 7.1, 0], [-0.1, 7.1, 0]];
    expect(footprintContainment(t, building.polygon, frame, corners).outsidePoints).toBe(0);
  });
});
