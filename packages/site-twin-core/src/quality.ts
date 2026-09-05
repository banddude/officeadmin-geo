import type { VisualFacadeComponent, VisualFacadeComposition } from "./types";

export interface FacadeCompositionQuality {
  acceptable: boolean;
  horizontalCoverage: number;
  leftEdge: number;
  rightEdge: number;
  maxTop: number;
  primaryComponentCount: number;
  averageConfidence: number;
  reasons: string[];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function primaryComponents(components: VisualFacadeComponent[]) {
  return components.filter((component) => component.kind === "volume" || component.kind === "tower");
}

function intervalCoverage(components: VisualFacadeComponent[]) {
  const intervals = components
    .map((component) => [clamp01(component.x - component.width / 2), clamp01(component.x + component.width / 2)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return { coverage: 0, leftEdge: 1, rightEdge: 0 };

  let coverage = 0;
  let [start, end] = intervals[0]!;
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      coverage += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  coverage += end - start;
  return {
    coverage: clamp01(coverage),
    leftEdge: intervals[0]![0],
    rightEdge: intervals[intervals.length - 1]![1],
  };
}

export function assessFacadeComposition(composition: VisualFacadeComposition | undefined): FacadeCompositionQuality {
  const components = primaryComponents(composition?.components ?? []);
  const { coverage, leftEdge, rightEdge } = intervalCoverage(components);
  const maxTop = components.length ? Math.max(...components.map((component) => component.top)) : 0;
  const averageConfidence = components.length
    ? components.reduce((sum, component) => sum + component.confidence, 0) / components.length
    : 0;
  const reasons: string[] = [];

  if (components.length < 1) reasons.push("no primary facade volumes");
  if (coverage < 0.72) reasons.push(`primary facade covers only ${(coverage * 100).toFixed(0)}% of visible width`);
  if (leftEdge > 0.22) reasons.push("left side of target facade is not reconstructed");
  if (rightEdge < 0.78) reasons.push("right side of target facade is not reconstructed");
  if (maxTop < 0.82) reasons.push("no primary component reaches the visible roofline");
  if (averageConfidence < 0.5) reasons.push("primary component confidence is too low");

  return {
    acceptable: reasons.length === 0,
    horizontalCoverage: coverage,
    leftEdge,
    rightEdge,
    maxTop,
    primaryComponentCount: components.length,
    averageConfidence,
    reasons,
  };
}
