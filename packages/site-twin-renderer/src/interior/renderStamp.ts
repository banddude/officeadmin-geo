/*
 * renderStamp.ts -- every render says what produced it (ported from the E4
 * viewer's render stamp).
 *
 * The stamp pins the code (commit + dirty state), the input (SHA-256 of the
 * exact model bytes and registration bytes that were drawn) and the drawing
 * parameters that change pixels. `renderId` is
 *
 *   sha256("commit|dirty:N|model:<sha>|registration:<sha>|minDrawn:<m>")[:12]
 *
 * and is printed in the page footer so an image and its record always match.
 *
 * A dirty tree is never hidden: `reproducible` is false and the page paints an
 * UNREPRODUCIBLE RENDER banner. With no commit at all there is no build record,
 * and the page says exactly that rather than implying provenance it lacks.
 *
 * On the laptop the synced copy has no .git, so the commit and the dirty count
 * arrive as the environment variables GIT_COMMIT and GIT_DIRTY_FILES at build
 * time; the demo's vite config reads them (see apps/site-twin-demo).
 */

export interface BuildInfo {
  commit: string | null;
  dirtyFiles: number | null;
  /** Where the two values came from: "env", "git" or "none". */
  source: string;
}

export interface RenderStamp {
  renderId: string | null;
  renderIdInputs: string;
  commit: string | null;
  dirtyFiles: number | null;
  buildSource: string;
  reproducible: boolean;
  problem: string | null;
  modelSha256: string;
  registrationSha256: string | null;
  minDrawnThickness_m: number;
  renderedAtUtc: string;
}

const COMMIT = /^[0-9a-f]{7,40}$/i;

export function normaliseBuildInfo(raw: unknown): BuildInfo {
  const info = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const commit = typeof info.commit === "string" && COMMIT.test(info.commit.trim()) ? info.commit.trim().toLowerCase() : null;
  const dirtyRaw = typeof info.dirtyFiles === "number" ? info.dirtyFiles : typeof info.dirtyFiles === "string" ? Number(info.dirtyFiles) : NaN;
  const dirtyFiles = Number.isInteger(dirtyRaw) && dirtyRaw >= 0 ? dirtyRaw : null;
  return { commit, dirtyFiles, source: typeof info.source === "string" ? info.source : "none" };
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeRenderStamp(args: {
  build: BuildInfo;
  modelText: string;
  registrationText: string | null;
  minDrawnThickness_m: number;
  now?: Date;
}): Promise<RenderStamp> {
  const { build } = args;
  const modelSha256 = await sha256Hex(args.modelText);
  const registrationSha256 = args.registrationText === null ? null : await sha256Hex(args.registrationText);
  const inputs = [
    build.commit ?? "no-commit",
    `dirty:${build.dirtyFiles ?? "unknown"}`,
    `model:${modelSha256}`,
    `registration:${registrationSha256 ?? "none"}`,
    `minDrawn:${args.minDrawnThickness_m}`,
  ].join("|");
  const renderId = build.commit ? (await sha256Hex(inputs)).slice(0, 12) : null;
  let problem: string | null = null;
  if (!build.commit) problem = "No build record: this page was not built from a known commit, so nothing on it can be tied to a known state of the code.";
  else if (build.dirtyFiles === null) problem = "The dirty state of the working tree is unknown, so this render cannot be called reproducible.";
  else if (build.dirtyFiles > 0) problem = `UNREPRODUCIBLE RENDER: the working tree had ${build.dirtyFiles} uncommitted path${build.dirtyFiles === 1 ? "" : "s"} when this was built. Commit ${build.commit.slice(0, 10)} alone does not reproduce it.`;
  return {
    renderId,
    renderIdInputs: "sha256(commit | dirty | model sha256 | registration sha256 | min drawn thickness)[:12]",
    commit: build.commit,
    dirtyFiles: build.dirtyFiles,
    buildSource: build.source,
    reproducible: problem === null,
    problem,
    modelSha256,
    registrationSha256,
    minDrawnThickness_m: args.minDrawnThickness_m,
    renderedAtUtc: (args.now ?? new Date()).toISOString(),
  };
}
