import { describe, expect, it } from "vitest";
import { classifyEntity, classifyRecord, disagreementNote } from "./provenance";
import { record } from "./testSupport";

describe("provenance classification reads Provenance.derivation and nothing else", () => {
  it("reads the class from Provenance.derivation on each record", () => {
    expect(classifyRecord(record("observed")).cls).toBe("observed");
    expect(classifyRecord(record("user")).cls).toBe("user");
    expect(classifyRecord(record("inferred")).cls).toBe("inferred");
  });

  it("fails closed: a record with no derivation is inferred, never observed", () => {
    expect(classifyRecord(record(undefined)).cls).toBe("inferred");
    expect(classifyRecord(record(null)).cls).toBe("inferred");
    expect(classifyEntity("wall", { provenance: [record(undefined)] }).cls).toBe("inferred");
  });

  it("does not trust source_kind: a measuring source with no derivation is still inferred", () => {
    const fromScan = record(undefined, { source_kind: "roomplan", method: "RoomPlan wall surface" });
    const fromDrawing = record(undefined, { source_kind: "pdf-electrical", method: "legend symbol match" });
    expect(classifyEntity("wall", { provenance: [fromScan] }).cls).toBe("inferred");
    expect(classifyEntity("port", { provenance: [fromDrawing] }).cls).toBe("inferred");
  });

  it("does not read attributes at any nesting level, in either direction", () => {
    // An attribute claiming observation cannot promote an unset record...
    const claimsObserved = record(undefined, { attributes: { derivation: "observed", observed: true } });
    expect(classifyEntity("wall", { provenance: [claimsObserved], attributes: { derivation: "observed" } }).cls).toBe("inferred");
    // ...and a lane diagnostic cannot override what derivation states. (The
    // electrical importer writes derivation "inferred" on the ports it
    // synthesizes; the attribute is only its diagnostic copy.)
    const port = { provenance: [record("observed")], attributes: { pdf_electrical: { inferred_for_circuit_semantics: true }, inferred_for_circuit_semantics: true } };
    expect(classifyEntity("port", port).cls).toBe("observed");
  });

  it("a derivation outside the contract's enum fails closed (no aliases)", () => {
    for (const value of ["designed", "Observed", " observed", "observed-from-source", "user-designed", 1, true]) {
      const verdict = classifyRecord({ source_kind: "test", source_id: "t", derivation: value });
      expect(verdict.cls, JSON.stringify(value)).toBe("inferred");
    }
  });

  it("the strictest record wins when records disagree", () => {
    expect(classifyEntity("wall", { provenance: [record("observed"), record("user")] }).cls).toBe("user");
    expect(classifyEntity("wall", { provenance: [record("user"), record("observed")] }).cls).toBe("user");
    expect(classifyEntity("wall", { provenance: [record("observed"), record("inferred"), record("observed")] }).cls).toBe("inferred");
    expect(classifyEntity("wall", { provenance: [record("observed"), record("observed")] }).cls).toBe("observed");
  });

  it("an element with no provenance records at all is inferred", () => {
    expect(classifyEntity("electrical_device", {}).cls).toBe("inferred");
    expect(classifyEntity("electrical_device", { provenance: [] }).cls).toBe("inferred");
    expect(classifyEntity("electrical_device", { provenance: "observed" }).cls).toBe("inferred");
  });

  it("routes, route fittings and conductors are inferred even when every record claims observed", () => {
    for (const kind of ["route", "route_fitting", "conductor"] as const) {
      const verdict = classifyEntity(kind, { provenance: [record("observed")] });
      expect(verdict.cls, kind).toBe("inferred");
      expect(verdict.floor?.cls).toBe("inferred");
    }
    expect(classifyEntity("electrical_device", { provenance: [record("observed")] }).floor).toBeNull();
  });

  it("explains a disagreement in plain English, naming the class it resolved to", () => {
    const verdict = classifyEntity("wall", { provenance: [record("observed"), record("inferred")] });
    expect(disagreementNote(verdict)).toBe(
      "This element draws on 2 sources that do not agree. It is shown as Inferred by the tool because the viewer always takes the least certain of them.",
    );
    expect(disagreementNote(classifyEntity("wall", { provenance: [record("observed"), record("observed")] }))).toBeNull();
  });
});
