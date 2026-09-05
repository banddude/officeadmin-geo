import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  RoofType,
  FacadeComponentKind,
  VisualFacadeComponent,
  VisualFacadeComposition,
  VisualFacadeObservation,
  VisualMassingObservation,
  VisualMassingVolume,
  VisualObservation,
  VisualOpening,
  WallName,
} from "@officeadmin-geo/site-twin-core";

const ROOF_TYPES = new Set<RoofType>(["flat", "gable", "hip", "shed", "mansard", "unknown"]);
const WALL_NAMES = new Set<WallName>(["front", "rear", "left", "right", "unknown"]);
const FACADE_COMPONENT_KINDS = new Set<FacadeComponentKind>(["volume", "tower", "balcony", "chimney", "other"]);

export interface OllamaVisionOptions {
  baseUrl?: string;
  model?: string;
  context?: {
    targetBearingDeg?: number;
    expectedBuildingHeightM?: number;
    targetDescription?: string;
  };
}

export interface TargetHouseRegion {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface CropImageRegionOptions {
  paddingFraction?: number;
  pythonExecutable?: string;
}

function clamp01(value: unknown, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export function normalizeTargetHouseRegion(value: unknown): TargetHouseRegion {
  if (!value || typeof value !== "object") throw new Error("Target localization result must be an object");
  const root = value as Record<string, unknown>;
  const firstBox = Array.isArray(root.bboxes) && root.bboxes[0] && typeof root.bboxes[0] === "object"
    ? root.bboxes[0] as Record<string, unknown>
    : undefined;
  const rawValue = firstBox?.bbox ?? root.bbox ?? root;
  let raw: Record<string, unknown>;
  if (Array.isArray(rawValue) && rawValue.length >= 4) {
    raw = { left: rawValue[0], top: rawValue[1], right: rawValue[2], bottom: rawValue[3] };
  } else if (rawValue && typeof rawValue === "object") {
    raw = rawValue as Record<string, unknown>;
  } else {
    throw new Error("Target localization result is missing bbox coordinates");
  }
  const left = clamp01(raw.left ?? raw.xMin ?? raw.x ?? 0);
  const top = clamp01(raw.top ?? raw.yMin ?? raw.y ?? 0);
  const rawRight = raw.right ?? raw.xMax;
  const rawBottom = raw.bottom ?? raw.yMax;
  const rawWidth = raw.width;
  const rawHeight = raw.height;
  const right = rawRight == null ? clamp01(left + Number(rawWidth ?? 0)) : clamp01(rawRight);
  const bottom = rawBottom == null ? clamp01(top + Number(rawHeight ?? 0)) : clamp01(rawBottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    visible: root.visible !== false && width >= 0.08 && height >= 0.08,
    x: left,
    y: top,
    width,
    height,
    confidence: clamp01(firstBox?.confidence ?? root.confidence, 0.5),
  };
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

function massingVolume(value: unknown): VisualMassingVolume | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const level = Number(record.level);
  if (!Number.isFinite(level)) return undefined;
  const rawSetback = typeof record.setback === "string" ? record.setback.toLowerCase() : "unknown";
  const setback = rawSetback === "none" || rawSetback === "slight" || rawSetback === "moderate" || rawSetback === "deep" ? rawSetback : "unknown";
  return {
    level: Math.max(0, Math.round(level)),
    widthFraction: Math.max(0.25, Math.min(1, Number(record.widthFraction) || 1)),
    depthFraction: Number.isFinite(Number(record.depthFraction)) ? Math.max(0.3, Math.min(1, Number(record.depthFraction))) : undefined,
    horizontalCenter: clamp01(record.horizontalCenter, 0.5),
    setback,
    color: typeof record.color === "string" ? record.color : undefined,
    material: typeof record.material === "string" ? record.material : undefined,
    confidence: clamp01(record.confidence, 0.6),
  };
}

function facadeComponent(value: unknown): VisualFacadeComponent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawKind = typeof record.kind === "string" ? record.kind.toLowerCase() : "other";
  const kind: FacadeComponentKind = FACADE_COMPONENT_KINDS.has(rawKind as FacadeComponentKind) ? rawKind as FacadeComponentKind : "other";
  const rawSetback = typeof record.setback === "string" ? record.setback.toLowerCase() : "unknown";
  const setback = rawSetback === "none" || rawSetback === "slight" || rawSetback === "moderate" || rawSetback === "deep" ? rawSetback : "unknown";
  const rawRoof = typeof record.roofType === "string" ? record.roofType.toLowerCase() : "unknown";
  const roofType = ROOF_TYPES.has(rawRoof as RoofType) ? rawRoof as RoofType : undefined;
  const bottom = clamp01(record.bottom, 0);
  const top = Math.max(bottom + 0.08, clamp01(record.top, 1));
  return {
    kind,
    x: clamp01(record.x, 0.5),
    width: Math.max(0.08, clamp01(record.width, 0.4)),
    bottom,
    top: Math.min(1, top),
    depthFraction: Number.isFinite(Number(record.depthFraction)) ? Math.max(0.2, Math.min(1, Number(record.depthFraction))) : undefined,
    setback,
    roofType,
    color: typeof record.color === "string" ? record.color : undefined,
    material: typeof record.material === "string" ? record.material : undefined,
    accentColor: typeof record.accentColor === "string" ? record.accentColor : undefined,
    accentMaterial: typeof record.accentMaterial === "string" ? record.accentMaterial : undefined,
    windowCount: Number.isFinite(Number(record.windowCount)) ? Math.max(0, Math.min(12, Math.round(Number(record.windowCount)))) : undefined,
    windowOrientation: record.windowOrientation === "vertical" || record.windowOrientation === "horizontal" || record.windowOrientation === "mixed" ? record.windowOrientation : "unknown",
    glazing: record.glazing === "low" || record.glazing === "medium" || record.glazing === "high" ? record.glazing : "unknown",
    hasDoor: typeof record.hasDoor === "boolean" ? record.hasDoor : undefined,
    deckLocation: record.deckLocation === "mid" || record.deckLocation === "roof" ? record.deckLocation : "unknown",
    railColor: typeof record.railColor === "string" ? record.railColor : undefined,
    confidence: clamp01(record.confidence, 0.6),
  };
}

function facadeComposition(value: unknown): VisualFacadeComposition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const components = Array.isArray(record.components)
    ? record.components.map(facadeComponent).filter((item): item is VisualFacadeComponent => Boolean(item))
    : [];
  if (!components.length) return undefined;
  return { components, confidence: clamp01(record.confidence, 0.6) };
}

function massing(value: unknown): VisualMassingObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const volumes = Array.isArray(record.volumes) ? record.volumes.map(massingVolume).filter((item): item is VisualMassingVolume => Boolean(item)) : [];
  if (!volumes.length) return undefined;
  const storiesVisible = Number(record.storiesVisible);
  return {
    storiesVisible: Number.isFinite(storiesVisible) ? Math.max(1, Math.round(storiesVisible)) : undefined,
    stepped: typeof record.stepped === "boolean" ? record.stepped : undefined,
    volumes: volumes.sort((a, b) => a.level - b.level),
    confidence: clamp01(record.confidence, 0.6),
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
    massing: massing(record.massing),
    facadeComposition: facadeComposition(record.facadeComposition),
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
    "MASSING IS REQUIRED when the target is visible: describe each visible street-facing floor/volume separately instead of treating the measured footprint as one full-height extrusion.",
    "FACADE COMPOSITION IS REQUIRED when the target is visible: identify distinct architectural pieces across the street-facing elevation, such as separate wings, a projecting tower, balcony, chimney, or materially distinct volume. Do not collapse materially or geometrically distinct pieces into one box.",
    "For facadeComposition components, x is the component center from 0 left to 1 right in the target-facing image, width is its facade-width fraction, bottom/top are vertical fractions of the complete visible target building from 0 bottom to 1 highest roofline, and depthFraction is its estimated fraction of the measured footprint depth. Use only geometry clearly visible in this image.",
    "For massing.volumes, widthFraction and depthFraction are fractions of the measured footprint envelope, horizontalCenter is 0 left to 1 right as seen from the target-facing camera, and setback describes how far that level sits behind the street-facing plane.",
    "Set massing.stepped=true when floors/volumes visibly terrace, step back, cantilever, or have different street-facing planes. Do not infer hidden rear geometry.",
    "Scan each visible target facade left-to-right and bottom-to-top before finalizing the windows and doors arrays. Include partially visible openings when their position is clear, with lower confidence.",
    "For every visible facade opening use normalized coordinates relative to that facade: x=0 left, x=1 right, y=0 bottom, y=1 top. width and height are normalized fractions.",
    "Use roof type only: flat, gable, hip, shed, mansard, unknown.",
    "Use wall only: front, rear, left, right, unknown.",
    "Return one JSON object with these keys and types. Do not copy measurements from this instruction; estimate every numeric value from the current image only.",
    "visible: boolean",
    "confidence: number 0..1",
    "storiesApprox: integer when inferable",
    "roof: {type, color?, material?, rooftopDeck?: boolean|null}",
    "massing: {storiesVisible?: integer, stepped?: boolean, confidence: number 0..1, volumes: array}",
    "facadeComposition: {confidence: number 0..1, components: array}",
    "Each facadeComposition component: {kind: volume|tower|balcony|chimney|other, x: number 0..1, width: number 0..1, bottom: number 0..1, top: number 0..1, depthFraction?: number 0.2..1, setback: none|slight|moderate|deep|unknown, roofType?: flat|gable|hip|shed|unknown, color?: string, material?: string, confidence: number 0..1}",
    "Each massing volume: {level: integer starting at 0, widthFraction: number 0.25..1, depthFraction?: number 0.3..1, horizontalCenter: number 0..1, setback: none|slight|moderate|deep|unknown, color?: string, material?: string, confidence: number 0..1}",
    "facades: array of {wall, confidence, colors: string[], materials: string[], windows: opening[], doors: opening[]}",
    "Each opening: {x: number 0..1, y: number 0..1, width: number 0..1, height: number 0..1, confidence: number 0..1, color?: string, material?: string, shape?: rect|arched|round|other}",
    "site: {stairs?: boolean|null, retainingWalls?: boolean|null, driveway?: boolean|null, grass?: boolean|null, sidewalk?: boolean|null, curb?: boolean|null, trees?: boolean|null, fence?: boolean|null, dominantHardscape?: string}",
    "notes: string[]",
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
      options: { temperature: 0.1, num_predict: 1_400 },
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

export async function locateTargetHouseWithOllama(
  imageBase64: string,
  options: OllamaVisionOptions = {},
): Promise<TargetHouseRegion> {
  const context = options.context;
  const instruction = [
    "Locate the TARGET HOUSE in this street-level image. This is localization only, not architectural analysis.",
    "The frame was programmatically aimed at the target parcel, so prefer the building structure near the target direction and horizontal center. Do not select a neighboring house just because it is larger or clearer.",
    "Return ONLY one JSON object with visible, confidence, and bbox.",
    "bbox must contain left, top, right, bottom as normalized image coordinates from 0 to 1.",
    "The bbox must tightly enclose the visible TARGET BUILDING STRUCTURE, including attached balconies and roof/parapet, but exclude retaining walls, street, sidewalk, detached vegetation, sky, and neighboring buildings.",
    "If vegetation partially hides the building, bound the building silhouette you can infer directly from connected visible structure. Do not expand the box to include the vegetation itself.",
    "If the target cannot be distinguished confidently, set visible=false rather than guessing.",
    context?.targetDescription ? `Target context: ${context.targetDescription}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
  const parsed = await requestOllamaJson(imageBase64, instruction, options, 256);
  return normalizeTargetHouseRegion(parsed);
}

export async function cropImageRegion(
  bytes: Buffer,
  region: Pick<TargetHouseRegion, "x" | "y" | "width" | "height">,
  options: CropImageRegionOptions = {},
): Promise<Buffer> {
  const script = fileURLToPath(new URL("./crop-image.py", import.meta.url));
  const python = options.pythonExecutable ?? process.env.SITE_TWIN_PYTHON ?? "python3";
  const args = [
    script,
    "--x", String(region.x),
    "--y", String(region.y),
    "--width", String(region.width),
    "--height", String(region.height),
    "--padding", String(options.paddingFraction ?? 0),
  ];
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Image crop failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      const output = Buffer.concat(stdout);
      if (output.length < 500) {
        reject(new Error(`Image crop returned only ${output.length} bytes`));
        return;
      }
      resolve(output);
    });
    child.stdin.end(bytes);
  });
}

export async function analyzeSiteContextWithOllama(
  imageBase64: string,
  options: OllamaVisionOptions = {},
): Promise<VisualObservation["site"]> {
  const parsed = await requestOllamaJson(imageBase64, [
    "Analyze only the SITE CONTEXT around the target house in this street-level frame. Do not analyze the house architecture.",
    "Return ONLY one JSON object with optional keys stairs, retainingWalls, driveway, grass, sidewalk, curb, trees, fence, dominantHardscape.",
    "For stairs, retainingWalls, driveway, grass, sidewalk, curb, trees, and fence: use true only when clearly visible, false only when the relevant visible area clearly rules it out, otherwise omit the key.",
    "Do not treat a balcony railing as a fence. Do not treat a sloped retaining wall as stairs. Do not infer hidden site features behind vegetation.",
  ].join("\n"), options, 320);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return {
    stairs: typeof record.stairs === "boolean" ? record.stairs : undefined,
    retainingWalls: typeof record.retainingWalls === "boolean" ? record.retainingWalls : undefined,
    driveway: typeof record.driveway === "boolean" ? record.driveway : undefined,
    grass: typeof record.grass === "boolean" ? record.grass : undefined,
    sidewalk: typeof record.sidewalk === "boolean" ? record.sidewalk : undefined,
    curb: typeof record.curb === "boolean" ? record.curb : undefined,
    trees: typeof record.trees === "boolean" ? record.trees : undefined,
    fence: typeof record.fence === "boolean" ? record.fence : undefined,
    dominantHardscape: typeof record.dominantHardscape === "string" ? record.dominantHardscape : undefined,
  };
}

export type FacadeBandHeight = "low" | "medium" | "tall";
export type FacadeBandPlane = "projects" | "flush" | "setback";
export type FacadeRegionPosition = "left" | "center" | "right";

export interface FacadeBandObservation {
  label: string;
  widthFraction: number;
  relativeHeight: FacadeBandHeight;
  projection: FacadeBandPlane;
  confidence: number;
}

export interface FacadeRegionObservation {
  position: FacadeRegionPosition;
  kind: FacadeComponentKind;
  wallColor?: string;
  wallMaterial?: string;
  accentColor?: string;
  accentMaterial?: string;
  relativeHeight: FacadeBandHeight;
  projection: FacadeBandPlane;
  windowCount?: number;
  windowOrientation?: "vertical" | "horizontal" | "mixed" | "unknown";
  glazing?: "low" | "medium" | "high" | "unknown";
  hasDoor?: boolean;
  deckLocation?: "mid" | "roof" | "unknown";
  railColor?: string;
  confidence: number;
}

async function requestOllamaJson(imageBase64: string, instruction: string, options: OllamaVisionOptions, maxPredict = 600) {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
  const model = options.model ?? "gemma3:4b";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: instruction, images: [imageBase64] }],
      stream: false,
      format: "json",
      options: { temperature: 0, num_predict: maxPredict },
    }),
  });
  if (!response.ok) throw new Error(`Ollama vision request failed with ${response.status}`);
  const payload = (await response.json()) as OllamaResponse;
  const content = payload.message?.content;
  if (!content) throw new Error("Ollama returned no message content");
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Ollama returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function bandHeight(value: unknown): FacadeBandHeight {
  const normalized = typeof value === "string" ? value.toLowerCase() : "medium";
  return normalized === "low" || normalized === "tall" ? normalized : "medium";
}

function bandPlane(value: unknown): FacadeBandPlane {
  const normalized = typeof value === "string" ? value.toLowerCase() : "flush";
  if (normalized.includes("project")) return "projects";
  if (normalized.includes("set")) return "setback";
  return "flush";
}

function recordString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export async function analyzeFacadeBandsWithOllama(
  imageBase64: string,
  options: OllamaVisionOptions = {},
): Promise<FacadeBandObservation[]> {
  const parsed = await requestOllamaJson(imageBase64, [
    "Look only at the target HOUSE above any retaining wall. Ignore landscaping, retaining walls, sidewalk, road, fences, and neighbors.",
    "Return ONLY JSON with key house_masses containing an array of the large PRIMARY architectural masses from image-left to image-right.",
    "A primary mass is a large wing or vertical tower. A narrow vertical section that is visibly taller and/or a different material than the wing beside it is its own tower, not part of that wing. Do not list windows, wall patches, railings, or each floor as separate masses.",
    "For each mass return label, approximate_fraction as a fraction of total visible house width, relative_height as low|medium|tall, projection as projects|flush|setback, and confidence 0..1.",
    "The fractions should collectively account for nearly all of the visible target-house width. Merge adjacent patches that belong to one architectural mass.",
  ].join("\n"), options);
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const raw = Array.isArray(root.house_masses) ? root.house_masses : Array.isArray(root.masses) ? root.masses : [];
  const bands = raw.flatMap((value): FacadeBandObservation[] => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const width = Number(record.approximate_fraction ?? record.widthFraction ?? record.width);
    return [{
      label: recordString(record, "label", "name") ?? "volume",
      widthFraction: Number.isFinite(width) ? Math.max(0.08, Math.min(1, width)) : 0.33,
      relativeHeight: bandHeight(record.relative_height ?? record.relativeHeight),
      projection: bandPlane(record.projection ?? record.facade_plane),
      confidence: clamp01(record.confidence, 0.72),
    }];
  });
  if (bands.length < 2 || bands.length > 5) return [];
  const sum = bands.reduce((total, band) => total + band.widthFraction, 0);
  if (sum <= 0) return [];
  return bands.map((band) => ({ ...band, widthFraction: band.widthFraction / sum }));
}

export async function analyzeFacadeRegionWithOllama(
  position: FacadeRegionPosition,
  imageBase64: string,
  options: OllamaVisionOptions = {},
): Promise<FacadeRegionObservation> {
  const parsed = await requestOllamaJson(imageBase64, [
    `This frame is aimed at the ${position.toUpperCase()} primary architectural region of the target HOUSE.`,
    "Ignore vegetation, retaining walls, sidewalk, road, fences, and neighboring buildings.",
    "Describe only the large house mass centered in this frame, not every small wall patch.",
    "Return ONLY one JSON object with: kind (volume|tower|balcony|chimney|other), wallColor, wallMaterial, accentColor, accentMaterial, relativeHeight (low|medium|tall), projection (projects|flush|setback), windowCount on its STREET-FACING plane, windowOrientation (vertical|horizontal|mixed|unknown), glazing (low|medium|high|unknown), hasDoor boolean, deckLocation (mid|roof|unknown), railColor, confidence 0..1.",
    "Use deckLocation=mid for a projecting balcony/deck partway up a facade and roof for a guardrail/terrace at the roof line. Do not call a wood soffit the dominant wall material when the main wall is stucco or concrete.",
  ].join("\n"), options);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const rawKind = (recordString(record, "kind", "mass_type") ?? "volume").toLowerCase();
  const kind: FacadeComponentKind = FACADE_COMPONENT_KINDS.has(rawKind as FacadeComponentKind) ? rawKind as FacadeComponentKind : rawKind.includes("tower") ? "tower" : "volume";
  const rawOrientation = (recordString(record, "windowOrientation", "window_orientation") ?? "unknown").toLowerCase();
  const windowOrientation = rawOrientation.includes("vertical") ? "vertical" : rawOrientation.includes("horizontal") ? "horizontal" : rawOrientation.includes("mixed") ? "mixed" : "unknown";
  const rawGlazing = (recordString(record, "glazing", "glazingAmount", "amount_type_of_glazing") ?? "unknown").toLowerCase();
  const glazing = rawGlazing.includes("high") || rawGlazing.includes("large") ? "high" : rawGlazing.includes("medium") ? "medium" : rawGlazing.includes("low") || rawGlazing.includes("small") ? "low" : "unknown";
  const rawDeck = (recordString(record, "deckLocation", "deck_location") ?? "unknown").toLowerCase();
  const deckLocation = rawDeck.includes("roof") ? "roof" : rawDeck.includes("mid") || rawDeck.includes("balcon") ? "mid" : "unknown";
  const count = Number(record.windowCount ?? record.window_count ?? record.number_of_window_openings ?? record.visible_window_count);
  return {
    position,
    kind,
    wallColor: recordString(record, "wallColor", "wall_color", "dominant_wall_material/color", "dominant_wall_material_color"),
    wallMaterial: recordString(record, "wallMaterial", "wall_material"),
    accentColor: recordString(record, "accentColor", "accent_color"),
    accentMaterial: recordString(record, "accentMaterial", "accent_material", "wood_accent/soffit_presence_and_location"),
    relativeHeight: bandHeight(record.relativeHeight ?? record.relative_height),
    projection: bandPlane(record.projection ?? record.facade_plane),
    windowCount: Number.isFinite(count) ? Math.max(0, Math.min(12, Math.round(count))) : undefined,
    windowOrientation,
    glazing,
    hasDoor: typeof record.hasDoor === "boolean" ? record.hasDoor : typeof record.visible_door === "boolean" ? record.visible_door : undefined,
    deckLocation,
    railColor: recordString(record, "railColor", "rail_color", "balcony_material_rail_color"),
    confidence: clamp01(record.confidence, 0.76),
  };
}
