import type {
  RoofType,
  VisualFacadeObservation,
  VisualObservation,
  VisualOpening,
  WallName,
} from "@officeadmin-geo/site-twin-core";

const ROOF_TYPES = new Set<RoofType>(["flat", "gable", "hip", "shed", "mansard", "unknown"]);
const WALL_NAMES = new Set<WallName>(["front", "rear", "left", "right", "unknown"]);

export interface OllamaVisionOptions {
  baseUrl?: string;
  model?: string;
  context?: {
    targetBearingDeg?: number;
    expectedBuildingHeightM?: number;
    targetDescription?: string;
  };
}

function clamp01(value: unknown, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function opening(value: unknown): VisualOpening | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const width = clamp01(record.width, 0.15);
  const height = clamp01(record.height, 0.18);
  return {
    x: clamp01(record.x),
    y: clamp01(record.y),
    width: Math.max(0.02, width),
    height: Math.max(0.02, height),
    confidence: clamp01(record.confidence),
    color: typeof record.color === "string" ? record.color : undefined,
    material: typeof record.material === "string" ? record.material : undefined,
    shape: record.shape === "arched" || record.shape === "round" || record.shape === "other" ? record.shape : "rect",
  };
}

function facade(value: unknown): VisualFacadeObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawWall = typeof record.wall === "string" ? record.wall.toLowerCase() : "unknown";
  const wall: WallName = WALL_NAMES.has(rawWall as WallName) ? rawWall as WallName : "unknown";
  return {
    wall,
    confidence: clamp01(record.confidence),
    colors: stringArray(record.colors),
    materials: stringArray(record.materials),
    windows: Array.isArray(record.windows) ? record.windows.map(opening).filter((item): item is VisualOpening => Boolean(item)) : [],
    doors: Array.isArray(record.doors) ? record.doors.map(opening).filter((item): item is VisualOpening => Boolean(item)) : [],
  };
}

export function normalizeVisualObservation(sourceImageId: string, value: unknown): VisualObservation {
  if (!value || typeof value !== "object") throw new Error("Vision result must be an object");
  const record = value as Record<string, unknown>;
  const rawRoof = record.roof && typeof record.roof === "object" ? record.roof as Record<string, unknown> : {};
  const rawType = typeof rawRoof.type === "string" ? rawRoof.type.toLowerCase() : "unknown";
  const roofType: RoofType = ROOF_TYPES.has(rawType as RoofType) ? rawType as RoofType : "unknown";
  const rawSite = record.site && typeof record.site === "object" ? record.site as Record<string, unknown> : {};

  return {
    sourceImageId,
    visible: record.visible === true,
    confidence: clamp01(record.confidence),
    storiesApprox: Number.isFinite(Number(record.storiesApprox)) ? Math.max(1, Math.round(Number(record.storiesApprox))) : undefined,
    roof: {
      type: roofType,
      color: typeof rawRoof.color === "string" ? rawRoof.color : undefined,
      material: typeof rawRoof.material === "string" ? rawRoof.material : undefined,
      rooftopDeck: typeof rawRoof.rooftopDeck === "boolean" ? rawRoof.rooftopDeck : undefined,
    },
    facades: Array.isArray(record.facades) ? record.facades.map(facade).filter((item): item is VisualFacadeObservation => Boolean(item)) : [],
    site: {
      stairs: typeof rawSite.stairs === "boolean" ? rawSite.stairs : undefined,
      retainingWalls: typeof rawSite.retainingWalls === "boolean" ? rawSite.retainingWalls : undefined,
      driveway: typeof rawSite.driveway === "boolean" ? rawSite.driveway : undefined,
      grass: typeof rawSite.grass === "boolean" ? rawSite.grass : undefined,
      sidewalk: typeof rawSite.sidewalk === "boolean" ? rawSite.sidewalk : undefined,
      curb: typeof rawSite.curb === "boolean" ? rawSite.curb : undefined,
      trees: typeof rawSite.trees === "boolean" ? rawSite.trees : undefined,
      fence: typeof rawSite.fence === "boolean" ? rawSite.fence : undefined,
      dominantHardscape: typeof rawSite.dominantHardscape === "string" ? rawSite.dominantHardscape : undefined,
    },
    notes: stringArray(record.notes),
  };
}

function prompt(options: OllamaVisionOptions) {
  const context = options.context;
  const lines = [
    "Analyze this street-level image for a 3D property reconstruction system.",
    "Return ONLY one JSON object. Do not include markdown or prose outside JSON.",
    "Describe only the primary target building that is visible in the direction of the supplied target context.",
    "If the target building is not confidently visible, set visible=false and do not describe a neighbor as the target.",
    "Never invent hidden windows, doors, roof geometry, stairs, or landscaping.",
    "Use null or omit an optional fact when the relevant area is hidden, cropped, occluded, or ambiguous. False means the feature is clearly absent in a visible relevant area, not merely unseen.",
    "Calibrate confidence conservatively: 0.95+ only for unusually clear and unambiguous target evidence; use 0.55-0.8 for partial or oblique views and below 0.5 when target identity is uncertain.",
    "For rooftopDeck specifically, report true only when a rooftop deck/guard/terrace is directly visible, false only when the roof is sufficiently visible to rule one out, otherwise null.",
    "Enumerate EVERY distinct visible window and door separately. Do not collapse a row of openings into one representative opening and do not report only the most obvious opening.",
    "Scan each visible target facade left-to-right and bottom-to-top before finalizing the windows and doors arrays. Include partially visible openings when their position is clear, with lower confidence.",
    "For every visible facade opening use normalized coordinates relative to that facade: x=0 left, x=1 right, y=0 bottom, y=1 top. width and height are normalized fractions.",
    "Use roof type only: flat, gable, hip, shed, mansard, unknown.",
    "Use wall only: front, rear, left, right, unknown.",
    "Required JSON shape:",
    JSON.stringify({
      visible: true,
      confidence: 0.8,
      storiesApprox: 2,
      roof: { type: "flat", color: "dark gray", material: "membrane", rooftopDeck: null },
      facades: [{
        wall: "front",
        confidence: 0.8,
        colors: ["white"],
        materials: ["stucco"],
        windows: [{ x: 0.2, y: 0.6, width: 0.25, height: 0.2, confidence: 0.8, color: "dark", shape: "rect" }],
        doors: [{ x: 0.7, y: 0, width: 0.12, height: 0.34, confidence: 0.8, material: "wood", color: "brown" }],
      }],
      site: { stairs: true, retainingWalls: null, driveway: null, grass: true, sidewalk: true, curb: true, trees: true, fence: null, dominantHardscape: "concrete" },
      notes: [],
    }),
  ];
  if (context?.targetBearingDeg != null) lines.push(`The target parcel is approximately at bearing ${context.targetBearingDeg.toFixed(1)} degrees from the camera.`);
  if (context?.expectedBuildingHeightM != null) lines.push(`Measured target building height is approximately ${context.expectedBuildingHeightM.toFixed(1)} meters. Use this only to disambiguate the target, not to invent appearance.`);
  if (context?.targetDescription) lines.push(`Target context: ${context.targetDescription}`);
  return lines.join("\n");
}

interface OllamaResponse {
  message?: { content?: string };
}

export async function analyzeImageWithOllama(
  sourceImageId: string,
  imageBase64: string,
  options: OllamaVisionOptions = {},
): Promise<VisualObservation> {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
  const model = options.model ?? "gemma3:4b";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt(options), images: [imageBase64] }],
      stream: false,
      format: "json",
      options: { temperature: 0.1 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama vision request failed with ${response.status}`);
  const payload = (await response.json()) as OllamaResponse;
  const content = payload.message?.content;
  if (!content) throw new Error("Ollama returned no message content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Ollama returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeVisualObservation(sourceImageId, parsed);
}
