// Shared headless-Chromium + CDP harness for the browser tests that need a
// real page (layout_large_hand.js, ai_stale_timer.js). Serves docs/ over HTTP
// and drives Chromium over raw CDP -- no extra dependency (same technique as
// smoke_browser.js). Needs Chromium/Chrome on PATH and Node >= 22 (global
// WebSocket).

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CASCADE_DOCS_DIR lets a test point at another build (e.g. to prove a regression test fails on old code).
const DOCS_DIR =
  process.env.CASCADE_DOCS_DIR ?? path.join(__dirname, "..", "docs");

export function findBrowser() {
  for (const name of [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
  ]) {
    try {
      execFileSync(name, ["--version"], { stdio: "ignore" });
      return name;
    } catch {
      /* next */
    }
  }
  return null;
}

export function startStaticServer(port) {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
  };
  const server = createServer(async (req, res) => {
    const pathOnly = (req.url || "/").split("?")[0];
    const filePath = path.join(
      DOCS_DIR,
      decodeURIComponent(pathOnly === "/" ? "/index.html" : pathOnly),
    );
    if (!filePath.startsWith(DOCS_DIR)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

export async function connect(browserBin, cdpPort) {
  const child = spawn(
    browserBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${cdpPort}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        target = await (
          await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, {
            method: "PUT",
          })
        ).json();
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!target) throw new Error("Chromium's CDP endpoint never came up");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = msgId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalJs = async (expression) => {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.result?.exceptionDetails) {
        throw new Error(
          `page eval threw: ${JSON.stringify(r.result.exceptionDetails)}`,
        );
      }
      return r.result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    return { child, ws, send, evalJs };
  } catch (e) {
    child.kill();
    throw e;
  }
}
