#!/usr/bin/env node
/*
 * capture.mjs -- screenshot the BUILT demo (dist/) from a list of deep links.
 *
 *   node scripts/capture.mjs --shots scripts/shots.tsv --out .captures [--chrome PATH]
 *
 * One headless Chrome, one tab, N navigations over the DevTools Protocol (no
 * npm dependencies: Node 22 ships a global WebSocket). A shot is taken only
 * when the page itself reports a framed interior (window.__SITE_TWIN_INTERIOR__
 * .ready) and a computed render stamp, then after two real animation frames --
 * never after a guessed delay. Each shot writes a PNG, the page's visible text
 * (so claims about what the page SAYS can be grepped) and its console errors.
 *
 * Shots file: TSV lines "name<TAB>query<TAB>what it should show<TAB>optional scroll selector"; # comments.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const SHOTS = resolve(ROOT, arg("--shots", "scripts/shots.tsv"));
const OUT = resolve(ROOT, arg("--out", ".captures"));
const CHROME = arg("--chrome", process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "chromium-browser");
const WIDTH = Number(arg("--width", "1600"));
const HEIGHT = Number(arg("--height", "1000"));
const HTTP_PORT = Number(arg("--port", "8797"));
const CDP_PORT = Number(arg("--debug-port", "9227"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".glb": "model/gltf-binary", ".svg": "image/svg+xml" };

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let path = join(DIST, decodeURIComponent(url.pathname));
    if (!path.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(path));
  });
  return new Promise((resolveServer) => server.listen(HTTP_PORT, "127.0.0.1", () => resolveServer(server)));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : ok(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 90000);
      this.pending.set(id, { resolve: ok, reject, timer });
    });
  }
}

async function connect() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((ok, bad) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", bad, { once: true }); });
      return new CDP(ws);
    } catch { await sleep(250); }
  }
  throw new Error("could not reach Chrome's DevTools endpoint");
}

async function evaluate(cdp, session, expression, awaitPromise = false) {
  const res = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, session);
  return res?.result?.value;
}

async function waitReady(cdp, session) {
  const probe = `JSON.stringify({ interior: window.__SITE_TWIN_INTERIOR__ || null, stamp: window.__SITE_TWIN_RENDER_STAMP__ ? { renderId: window.__SITE_TWIN_RENDER_STAMP__.renderId, problem: window.__SITE_TWIN_RENDER_STAMP__.problem } : null })`;
  let last = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const raw = await evaluate(cdp, session, probe);
    last = raw ? JSON.parse(raw) : null;
    if (last?.interior?.ready && last.stamp) {
      // Let damping, label projection and shader compiles settle, then two real frames.
      await sleep(1200);
      await evaluate(cdp, session, "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))", true);
      return { ready: true, ...last };
    }
    await sleep(250);
  }
  return { ready: false, ...last };
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) throw new Error(`no build at ${DIST}; run vite build first`);
  mkdirSync(OUT, { recursive: true });
  const shots = readFileSync(SHOTS, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
    const [name, query = "", shows = "", scrollSelector = ""] = l.split("\t");
    return { name: name.trim(), query: query.trim(), shows: shows.trim(), scrollSelector: scrollSelector.trim() };
  });
  const only = arg("--only", "");
  const selected = only ? shots.filter((s) => only.split(",").includes(s.name)) : shots;
  const server = await serve();
  const profile = mkdtempSync(join(tmpdir(), "site-twin-capture-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader",
    `--window-size=${WIDTH},${HEIGHT}`, `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank",
  ], { stdio: "ignore" });
  const cleanup = () => {
    try { chrome.kill(); } catch {}
    try { server.close(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  process.on("exit", cleanup);
  const manifest = [];
  let cdp;
  try {
    cdp = await connect();
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
    let consoleLines = [];
    cdp.listeners.push((msg) => {
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
        consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      }
      if (msg.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    });
    const webgl = await evaluate(cdp, sessionId, "(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return 'no webgl'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl (renderer hidden)'; })()");
    console.log(`WebGL renderer: ${webgl}`);
    for (const shot of selected) {
      consoleLines = [];
      const url = `http://127.0.0.1:${HTTP_PORT}/index.html${shot.query ? `?${shot.query}` : ""}`;
      await cdp.send("Page.navigate", { url }, sessionId);
      const state = await waitReady(cdp, sessionId);
      if (shot.scrollSelector) {
        await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(shot.scrollSelector)})?.scrollIntoView({block:'start'})`);
        await evaluate(cdp, sessionId, "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))", true);
      }
      const png = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(OUT, `${shot.name}.png`), Buffer.from(png.data, "base64"));
      const text = await evaluate(cdp, sessionId, "document.body.innerText");
      writeFileSync(join(OUT, `${shot.name}.txt`), `${url}\n\n${text ?? ""}\n\n--- console ---\n${consoleLines.join("\n")}\n`);
      manifest.push({ ...shot, url, ready: state.ready, interior: state.interior, stamp: state.stamp, consoleErrors: consoleLines.length });
      console.log(`${state.ready ? "ok  " : "FAIL"} ${shot.name}  ready=${state.ready} visible=${state.interior?.visible} audit=${state.interior?.auditProblems} render=${state.stamp?.renderId} console=${consoleLines.length}`);
    }
  } finally {
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ webglNote: "see stdout", width: WIDTH, height: HEIGHT, shots: manifest }, null, 2));
    cdp?.ws.close();
    cleanup();
  }
  if (manifest.some((m) => !m.ready)) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exit(1); });
