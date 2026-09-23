/*
 * provenance.ts -- the interior viewer's provenance classification POLICY.
 *
 * Ported from the E4 viewer (app/provenance.js), which was verified on real
 * input before it was retired. The binding rule it implements:
 *
 *   every rendered element resolves to exactly one of
 *     "observed"  measured from a source
 *     "user"      specified by a person
 *     "inferred"  worked out by the tool; no source shows it
 *   and anything that cannot be positively classified resolves to "inferred".
 *   There is no "unknown" bucket and no fail-open default.
 *
 * The class is read from `Provenance.derivation` AND NOTHING ELSE. Two things
 * are deliberately NOT consulted, and a test pins each one:
 *
 *   - `source_kind`. The electrical importer synthesizes Port entities that
 *     carry the importer's own source kind, so a source-kind table drew a port
 *     the tool invented exactly like one recognized from a drawing.
 *   - `attributes`, at any nesting level. E4 still read
 *     `attributes.inferred_for_circuit_semantics`; the canonical contract
 *     (oabm/model/common.py, is_observed) says lane attributes are diagnostics,
 *     not the source of truth, because a consumer that guesses the wrong
 *     nesting level finds nothing and absent reads as "not inferred". E4's read
 *     was in fact at the wrong level (the importer nests it under
 *     `attributes.pdf_electrical`), so it never fired. It is not ported.
 *
 * E4 also accepted loose aliases ("designed", "Observed ", ...). The contract's
 * enum is exact, so this port accepts exactly "observed" | "user" | "inferred";
 * any other value is not a claim this viewer can honour and fails closed.
 *
 * Resolution order, strictest wins (inferred > user > observed):
 *   1. entity-kind floors -- routes, route fittings and conductors are
 *      inferred whatever their records say (E4's binding floors)
 *   2. Provenance.derivation on each record
 *   3. no records, or a record with no usable derivation -> inferred
 */
import type { Derivation, EntityKind, Provenance } from "./canonical";

export type ProvenanceClass = Derivation;

export const OBSERVED = "observed" as const;
export const USER = "user" as const;
export const INFERRED = "inferred" as const;
export const CLASSES: readonly ProvenanceClass[] = [OBSERVED, USER, INFERRED];

const RANK: Record<ProvenanceClass, number> = { observed: 0, user: 1, inferred: 2 };

/** Developer-facing labels (E4 wording). */
export const CLASS_LABEL: Record<ProvenanceClass, string> = {
  observed: "observed-from-source",
  user: "user-designed",
  inferred: "inferred",
};

/** What a building owner reads. Adds no class and changes no decision. */
export const CLASS_CUSTOMER: Record<ProvenanceClass, { name: string; blurb: string }> = {
  observed: {
    name: "Measured from a source",
    blurb: "A scan, survey or plan shows this. Its position and size were read from that source.",
  },
  user: {
    name: "Specified by a person",
    blurb: "A person placed or drew this. It reflects a decision, not a measurement.",
  },
  inferred: {
    name: "Inferred by the tool",
    blurb: "Nothing in a source shows this. The tool worked it out, so treat its shape and position as a proposal.",
  },
};

/** Entity kinds that can never be better than the stated class. */
export const KIND_FLOOR: Partial<Record<EntityKind, { cls: ProvenanceClass; why: string }>> = {
  conductor: { cls: INFERRED, why: "derived conductors are always inferred: no source shows an individual wire" },
  route: { cls: INFERRED, why: "a routed path is inferred until a source actually shows that path" },
  route_fitting: { cls: INFERRED, why: "fittings are produced by the router, not shown by a source" },
};

export function stricter(a: ProvenanceClass | null, b: ProvenanceClass | null): ProvenanceClass | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

function isDerivation(value: unknown): value is Derivation {
  return value === OBSERVED || value === USER || value === INFERRED;
}

export interface RecordVerdict { cls: ProvenanceClass; basis: string }

/** Classify ONE provenance record from its `derivation` field alone. */
export function classifyRecord(record: unknown): RecordVerdict {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { cls: INFERRED, basis: "malformed provenance record" };
  }
  const derivation = (record as Provenance).derivation;
  if (isDerivation(derivation)) {
    return { cls: derivation, basis: `Provenance.derivation = ${JSON.stringify(derivation)}` };
  }
  if (derivation === undefined || derivation === null) {
    return {
      cls: INFERRED,
      basis: "Provenance.derivation is unset; a record that states no class is not a claim of observation",
    };
  }
  return {
    cls: INFERRED,
    basis: `Provenance.derivation = ${JSON.stringify(derivation)} is not one of observed/user/inferred; failing closed`,
  };
}

export interface EntityVerdict {
  cls: ProvenanceClass;
  label: string;
  reasons: string[];
  records: unknown[];
  /** Set when an entity-kind floor, not the records, decided the class. */
  floor: { cls: ProvenanceClass; why: string } | null;
}

/** Classify an entity: kind floor, then every record, strictest wins. */
export function classifyEntity(kind: EntityKind | "registration", entity: unknown): EntityVerdict {
  const reasons: string[] = [];
  let cls: ProvenanceClass | null = null;

  const floor = kind === "registration" ? undefined : KIND_FLOOR[kind];
  if (floor) {
    cls = floor.cls;
    reasons.push(`${CLASS_LABEL[floor.cls]} (hard rule): ${floor.why}`);
  }

  const raw = entity && typeof entity === "object" ? (entity as { provenance?: unknown }).provenance : undefined;
  const records: unknown[] = Array.isArray(raw) ? raw : [];
  if (!records.length) {
    cls = stricter(cls, INFERRED);
    reasons.push("inferred (fail closed): the element carries no provenance records at all");
  }
  for (const record of records) {
    const verdict = classifyRecord(record);
    cls = stricter(cls, verdict.cls);
    reasons.push(`${CLASS_LABEL[verdict.cls]}: ${verdict.basis}`);
  }

  const resolved: ProvenanceClass = cls ?? INFERRED;
  return { cls: resolved, label: CLASS_LABEL[resolved], reasons, records, floor: floor ?? null };
}

/**
 * The plain-English account shown in the element panel when an element's
 * records disagree, in E4's words. Returns null when the records agree.
 */
export function disagreementNote(verdict: EntityVerdict): string | null {
  const distinct = new Set(verdict.records.map((record) => classifyRecord(record).cls));
  if (distinct.size < 2) return null;
  return (
    `This element draws on ${verdict.records.length} sources that do not agree. ` +
    `It is shown as ${CLASS_CUSTOMER[verdict.cls].name} because the viewer always takes the least certain of them.`
  );
}
