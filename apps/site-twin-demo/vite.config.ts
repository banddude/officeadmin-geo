import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function git(args: string[]) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/*
 * What code produced this build, for the interior's render stamp.
 *
 * The laptop builds from an rsync'd copy with no .git, so the commit and the
 * number of dirty paths arrive as GIT_COMMIT / GIT_DIRTY_FILES. Without them,
 * git is asked -- but only if this checkout IS the repository root, so a copy
 * nested inside some other repository can never report that repository's
 * commit. Otherwise the build says it has no build record.
 */
function buildInfo() {
  if (process.env.GIT_COMMIT) {
    return { commit: process.env.GIT_COMMIT, dirtyFiles: process.env.GIT_DIRTY_FILES ?? null, source: "env" };
  }
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top && resolve(top) === repoRoot) {
    const status = git(["status", "--porcelain"]);
    return { commit: git(["rev-parse", "HEAD"]), dirtyFiles: status === null ? null : status.split("\n").filter(Boolean).length, source: "git" };
  }
  return { commit: null, dirtyFiles: null, source: "none" };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __SITE_TWIN_BUILD__: JSON.stringify(buildInfo()),
  },
});
