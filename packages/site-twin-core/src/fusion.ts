import { nearestFacadeEdgeIndex } from "./geometry";
import type {
  FusedAlternative,
  FusedValue,
  RoofType,
  SemanticFacade,
  SemanticOpening,
  SemanticSiteModel,
  SiteGeometry,
  StreetImageCandidate,
  VisualObservation,
  WallName,
} from "./types";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function imageWeight(imageId: string, imagery: StreetImageCandidate[]) {
  const image = imagery.find((candidate) => candidate.id === imageId);
  return clamp01(image?.score ?? 0.6);
}

function observationWeight(observation: VisualObservation, imagery: StreetImageCandidate[]) {
  return clamp01(observation.confidence) * imageWeight(observation.sourceImageId, imagery);
}

function weightedMode<T extends string | number>(
  entries: Array<{ value: T; weight: number; sourceImageId: string }>,
  fallback: T,
): FusedValue<T> {
  if (entries.length === 0) {
    return { value: fallback, confidence: 0, sourceImageIds: [] };
  }

  const totals = new Map<T, { total: number; sources: string[] }>();
  for (const entry of entries) {
    const current = totals.get(entry.value) ?? { total: 0, sources: [] };
    current.total += entry.weight;
    current.sources.push(entry.sourceImageId);
    totals.set(entry.value, current);
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  const winner = sorted[0]!;
  const totalWeight = sorted.reduce((sum, [, detail]) => sum + detail.total, 0);
  const alternatives: FusedAlternative<T>[] = sorted.slice(1).map(([value, detail]) => ({
    value,
    confidence: totalWeight > 0 ? detail.total / totalWeight : 0,
  }));

  return {
    value: winner[0],
    confidence: totalWeight > 0 ? winner[1].total / totalWeight : 0,
    sourceImageIds: [...new Set(winner[1].sources)],
    alternatives: alternatives.length ? alternatives : undefined,
  };
}

function fuseBoolean(
  key: keyof VisualObservation["site"],
  observations: VisualObservation[],
  imagery: StreetImageCandidate[],
  measuredPositive = false,
): FusedValue<boolean> {
  const positiveSources: string[] = [];
  let positiveWeight = measuredPositive ? 1 : 0;
  let negativeWeight = 0;

  for (const observation of observations) {
    const value = observation.site[key];
    if (typeof value !== "boolean") continue;
    const weight = observationWeight(observation, imagery);
    if (value) {
      positiveWeight += weight;
      positiveSources.push(observation.sourceImageId);
    } else {
      // Absence in an image is weak negative evidence because the feature may be outside the frame.
      negativeWeight += weight * 0.25;
    }
  }

  const total = positiveWeight + negativeWeight;
  if (total === 0) {
    return { value: false, confidence: 0, sourceImageIds: [] };
  }
  const value = positiveWeight >= negativeWeight;
  return {
    value,
    confidence: Math.max(positiveWeight, negativeWeight) / total,
    sourceImageIds: [...new Set(positiveSources)],
  };
}

function fuseStringList(
  values: Array<{ values: string[]; weight: number; sourceImageId: string }>,
): FusedValue<string[]> {
  const totals = new Map<string, { total: number; sources: string[] }>();
  for (const group of values) {
    for (const raw of group.values) {
      const value = raw.trim().toLowerCase();
      if (!value) continue;
      const current = totals.get(value) ?? { total: 0, sources: [] };
      current.total += group.weight;
      current.sources.push(group.sourceImageId);
      totals.set(value, current);
    }
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  const max = sorted[0]?.[1].total ?? 0;
  const kept = sorted.filter(([, detail]) => detail.total >= max * 0.45).slice(0, 4);
  return {
    value: kept.map(([value]) => value),
    confidence: kept.length ? Math.min(1, kept.reduce((sum, [, d]) => sum + d.total, 0) / Math.max(1, values.length)) : 0,
    sourceImageIds: [...new Set(kept.flatMap(([, detail]) => detail.sources))],
  };
}

function openingDistance(a: SemanticOpening, b: SemanticOpening) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function fuseOpenings(
  wall: WallName,
  kind: "windows" | "doors",
  observations: VisualObservation[],
  imagery: StreetImageCandidate[],
): SemanticOpening[] {
  const candidates = observations.flatMap((observation) => {
    const weight = observationWeight(observation, imagery);
    return observation.facades
      .filter((facade) => facade.wall === wall)
      .flatMap((facade) => facade[kind].map((opening) => ({
        opening,
        weight: weight * facade.confidence * opening.confidence,
      })));
  });

  const clusters: Array<Array<(typeof candidates)[number]>> = [];
  for (const candidate of candidates) {
    const normalized: SemanticOpening = {
      x: candidate.opening.x,
      y: candidate.opening.y,
      width: candidate.opening.width,
      height: candidate.opening.height,
      confidence: candidate.weight,
      color: candidate.opening.color,
      material: candidate.opening.material,
    };
    const cluster = clusters.find((group) => {
      const first = group[0]!;
      return openingDistance(normalized, {
        x: first.opening.x,
        y: first.opening.y,
        width: first.opening.width,
        height: first.opening.height,
        confidence: first.weight,
      }) < 0.14;
    });
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }

  return clusters
    .map((cluster) => {
      const total = cluster.reduce((sum, item) => sum + item.weight, 0) || 1;
      const weighted = (key: "x" | "y" | "width" | "height") =>
        cluster.reduce((sum, item) => sum + item.opening[key] * item.weight, 0) / total;
      const best = [...cluster].sort((a, b) => b.weight - a.weight)[0]!;
      return {
        x: clamp01(weighted("x")),
        y: clamp01(weighted("y")),
        width: clamp01(weighted("width")),
        height: clamp01(weighted("height")),
        confidence: clamp01(total / Math.max(1, observations.length)),
        color: best.opening.color,
        material: best.opening.material,
      } satisfies SemanticOpening;
    })
    .sort((a, b) => a.x - b.x);
}

function fuseFacade(
  wall: Exclude<WallName, "unknown">,
  observations: VisualObservation[],
  imagery: StreetImageCandidate[],
): SemanticFacade {
  const matches = observations.flatMap((observation) => {
    const weight = observationWeight(observation, imagery);
    return observation.facades
      .filter((facade) => facade.wall === wall)
      .map((facade) => ({ facade, weight: weight * facade.confidence, sourceImageId: observation.sourceImageId }));
  });

  return {
    wall,
    colors: fuseStringList(matches.map((match) => ({ values: match.facade.colors, weight: match.weight, sourceImageId: match.sourceImageId }))),
    materials: fuseStringList(matches.map((match) => ({ values: match.facade.materials, weight: match.weight, sourceImageId: match.sourceImageId }))),
    windows: fuseOpenings(wall, "windows", observations, imagery),
    doors: fuseOpenings(wall, "doors", observations, imagery),
  };
}

export function fuseSiteModel(
  address: string,
  geometry: SiteGeometry,
  imagery: StreetImageCandidate[],
  observations: VisualObservation[],
): SemanticSiteModel {
  const useful = observations.filter((observation) => observation.visible && observation.confidence > 0.1);
  const roofEntries = useful
    .filter((observation) => observation.roof?.type)
    .map((observation) => ({
      value: observation.roof!.type as RoofType,
      weight: observationWeight(observation, imagery),
      sourceImageId: observation.sourceImageId,
    }));
  const roofType = weightedMode(roofEntries, "unknown" as RoofType);
  const roofColor = weightedMode(
    useful.filter((o) => o.roof?.color).map((o) => ({ value: o.roof!.color!, weight: observationWeight(o, imagery), sourceImageId: o.sourceImageId })),
    "unknown",
  );
  const roofMaterial = weightedMode(
    useful.filter((o) => o.roof?.material).map((o) => ({ value: o.roof!.material!, weight: observationWeight(o, imagery), sourceImageId: o.sourceImageId })),
    "unknown",
  );
  const rooftopDeck = fuseBoolean(
    "stairs", // placeholder key is not used because deck is roof-specific below
    [],
    imagery,
    false,
  );
  const deckEntries = useful.filter((o) => typeof o.roof?.rooftopDeck === "boolean");
  if (deckEntries.length) {
    const yes = deckEntries.filter((o) => o.roof?.rooftopDeck).reduce((sum, o) => sum + observationWeight(o, imagery), 0);
    const no = deckEntries.filter((o) => !o.roof?.rooftopDeck).reduce((sum, o) => sum + observationWeight(o, imagery) * 0.4, 0);
    rooftopDeck.value = yes >= no;
    rooftopDeck.confidence = yes + no > 0 ? Math.max(yes, no) / (yes + no) : 0;
    rooftopDeck.sourceImageIds = deckEntries.filter((o) => o.roof?.rooftopDeck).map((o) => o.sourceImageId);
  }

  const storyEntries = useful
    .filter((o): o is VisualObservation & { storiesApprox: number } => typeof o.storiesApprox === "number")
    .map((o) => ({ value: Math.max(1, Math.round(o.storiesApprox)), weight: observationWeight(o, imagery), sourceImageId: o.sourceImageId }));

  const warnings: string[] = [];
  if (imagery.length === 0) warnings.push("No street imagery was available for this reconstruction.");
  if (useful.length === 0) warnings.push("No useful vision observations were available. Rendering measured geometry only.");
  if (roofType.confidence < 0.55) warnings.push("Roof type is low confidence or disputed.");

  const sidewalkMeasured = geometry.sidewalks.length > 0;

  const primaryBuilding = geometry.buildings.find((building) => building.id === geometry.primaryBuildingId) ?? geometry.buildings[0];
  const alignmentSource = imagery[0];
  const frontEdgeIndex = primaryBuilding && alignmentSource
    ? nearestFacadeEdgeIndex(primaryBuilding.polygon, alignmentSource)
    : undefined;

  return {
    schemaVersion: 1,
    facadeAlignment: frontEdgeIndex != null && alignmentSource ? {
      frontEdgeIndex,
      sourceImageId: alignmentSource.id,
      confidence: Math.max(0, Math.min(1, alignmentSource.score ?? 0.5)),
    } : undefined,
    address,
    center: geometry.center,
    generatedAt: new Date().toISOString(),
    geometry,
    storiesApprox: storyEntries.length ? weightedMode(storyEntries, 1) : undefined,
    roof: {
      value: {
        type: roofType.value,
        color: roofColor.value === "unknown" ? undefined : roofColor.value,
        material: roofMaterial.value === "unknown" ? undefined : roofMaterial.value,
        rooftopDeck: deckEntries.length ? rooftopDeck.value : undefined,
      },
      confidence: roofType.confidence,
      sourceImageIds: [...new Set([...roofType.sourceImageIds, ...roofColor.sourceImageIds, ...roofMaterial.sourceImageIds, ...rooftopDeck.sourceImageIds])],
      alternatives: roofType.alternatives?.map((alternative) => ({ value: { type: alternative.value }, confidence: alternative.confidence })),
    },
    facades: ["front", "rear", "left", "right"].map((wall) => fuseFacade(wall as Exclude<WallName, "unknown">, useful, imagery)),
    site: {
      stairs: fuseBoolean("stairs", useful, imagery),
      retainingWalls: fuseBoolean("retainingWalls", useful, imagery),
      driveway: fuseBoolean("driveway", useful, imagery),
      grass: fuseBoolean("grass", useful, imagery),
      sidewalk: fuseBoolean("sidewalk", useful, imagery, sidewalkMeasured),
      curb: fuseBoolean("curb", useful, imagery),
      trees: fuseBoolean("trees", useful, imagery),
      fence: fuseBoolean("fence", useful, imagery),
      dominantHardscape: undefined,
    },
    imagery,
    observations,
    warnings,
  };
}
