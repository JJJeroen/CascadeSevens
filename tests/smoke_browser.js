// Story #8: a committed, real-browser smoke test. Every real UI bug in
// this project's history (the #modalRoot invisible-overlay bug, the
// #rearrangeControls visibility bug, several "button stays disabled"
// reports) was invisible to the headless engine/AI test suite and only
// ever caught by a human actually clicking through the page -- this script
// drives the real, compiled docs/index.html through a real headless
// Chromium tab via the Chrome DevTools Protocol (raw CDP over Node's
// built-in WebSocket -- no new dependency, no separate browser-download
// step; reuses the exact technique this project's own throwaway CDP
// debug scripts always used, just committed and made deterministic this
// time). Needs a Chromium/Chrome binary on PATH (checks a few common
// names); GitHub's ubuntu-latest runners ship one, as does this project's
// own dev machine.
//
// Flow (matches the story's acceptance criteria exactly): new game ->
// draw -> lay a meld -> discard. Because main doesn't have a deterministic
// deal-seed feature (see issue #16, separate PR), this retries "New Game"
// until the dealt hand actually contains a meldable set-of-3 or run-of-3
// (no jokers needed, to keep the check simple) -- empirically ~19% of
// hands qualify after one closed-pile draw, so 40 retries succeeds well
// north of 99.9% of the time. Also handles Turn 0 (always declines, same
// as the AI) and waits out an AI-first-turn if round 1's random starter
// coin flip picks the AI.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, "..", "docs");
const PORT = 8791;
const CDP_PORT = 9822;
const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const BROWSER_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
];

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function findBrowser() {
  for (const name of BROWSER_CANDIDATES) {
    try {
      execFileSync(name, ["--version"], { stdio: "ignore" });
      return name;
    } catch {
      /* try the next candidate name */
    }
  }
  return null;
}

function startStaticServer() {
  const server = createServer(async (req, res) => {
    const pathOnly = (req.url || "/").split("?")[0];
    const urlPath = pathOnly === "/" ? "/index.html" : pathOnly;
    const filePath = path.join(DOCS_DIR, decodeURIComponent(urlPath));
    if (!filePath.startsWith(DOCS_DIR)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      const type =
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          ext
        ] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

async function connectCdp(browserBin) {
  const child = spawn(
    browserBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=900,1400",
    ],
    { stdio: "ignore" },
  );
  // A ChildProcess handle keeps Node's event loop alive on its own until
  // it exits, independent of whatever else the script is doing -- if
  // anything below throws before this function returns `child` to the
  // caller's try/finally, an un-killed child leaks and the whole process
  // hangs forever instead of exiting on the thrown error (confirmed in CI:
  // a run sat "pending" for 20+ minutes instead of failing in seconds).
  try {
    await new Promise((r) => setTimeout(r, 1000));
    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json();
    if (typeof WebSocket === "undefined") {
      throw new Error(
        "no global WebSocket in this Node runtime -- needs Node >=21 (stable since Node 22); this repo's package.json engines field allows >=18, which doesn't have it",
      );
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return await finishCdpSetup(child, ws);
  } catch (e) {
    child.kill();
    throw e;
  }
}

async function finishCdpSetup(child, ws) {
  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evalJs(expression) {
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
  }
  await send("Page.enable");
  await send("Runtime.enable");
  return { child, ws, send, evalJs };
}

async function clickSelector(page, selector) {
  await page.evalJs(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
}

async function clickButtonWithText(page, text) {
  return page.evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

async function readHand(page) {
  return page.evalJs(`Array.from(document.querySelectorAll('#hand .card')).map(el => {
    const rankEl = el.querySelector('.rank');
    const suitEl = el.querySelector('.suit');
    return {
      rank: rankEl ? rankEl.textContent : el.textContent.trim(),
      suitSymbol: suitEl ? suitEl.textContent : null,
    };
  })`);
}

function findSimpleMeldIndices(hand) {
  const rankGroups = {};
  hand.forEach((c, i) => {
    if (c.rank === "JOKER") return;
    (rankGroups[c.rank] = rankGroups[c.rank] || []).push(i);
  });
  for (const rank of Object.keys(rankGroups)) {
    if (rankGroups[rank].length >= 3) return rankGroups[rank].slice(0, 3);
  }
  const suitGroups = {};
  hand.forEach((c, i) => {
    if (c.rank === "JOKER") return;
    (suitGroups[c.suitSymbol] = suitGroups[c.suitSymbol] || []).push({
      i,
      r: RANKS.indexOf(c.rank),
    });
  });
  for (const suit of Object.keys(suitGroups)) {
    const entries = suitGroups[suit].slice().sort((a, b) => a.r - b.r);
    for (let i = 0; i < entries.length - 2; i++) {
      if (
        entries[i + 1].r === entries[i].r + 1 &&
        entries[i + 2].r === entries[i].r + 2
      ) {
        return [entries[i].i, entries[i + 1].i, entries[i + 2].i];
      }
    }
  }
  return null;
}

async function clickHandCardAtIndex(page, index) {
  await page.evalJs(
    `document.querySelectorAll('#hand .card')[${index}].click()`,
  );
}

async function isDisabled(page, selector) {
  return page.evalJs(
    `document.querySelector(${JSON.stringify(selector)}).disabled`,
  );
}

// Always declines, same default as the AI -- keeps this deterministic.
// Polls rather than clicking a fixed number of times: whoever isn't the
// current askee just has to wait (the AI's own Turn 0 response runs on a
// ~500ms setTimeout in app.ts, same as its normal turns), and if round 1's
// coin flip picks the AI as starter, "Turn 0: waiting on the AI..." can be
// showing with nothing yet to click. Exits once Part 1 genuinely opens up
// (drawPileBtn enabled) or the timeout is hit.
async function resolveTurn0IfPresent(page, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isDisabled(page, "#drawPileBtn"))) return true;
    await clickButtonWithText(page, "Decline");
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Hard ceiling, independent of any specific step's own error handling: a
// normal (ref'd) timer forces the process to exit even if something else
// leaked a handle that would otherwise keep the event loop alive forever
// (exactly what happened in CI once before this existed -- 20+ minutes
// "pending" instead of a fast, clear failure). 90s is generous next to the
// typical/worst-case runtime measured locally (~1-60s across the New Game
// retry loop).
const watchdog = setTimeout(() => {
  console.log(
    "FAIL: watchdog timeout (90s) -- something hung; see above for the last thing that ran.",
  );
  process.exit(1);
}, 90000);

async function main() {
  const browserBin = findBrowser();
  if (!browserBin) {
    fail(
      `no Chromium/Chrome binary found on PATH (tried: ${BROWSER_CANDIDATES.join(", ")}) -- install one to run this smoke test.`,
    );
    return;
  }

  // A listening http.Server, like a live ChildProcess, keeps Node's event
  // loop alive on its own -- server.close() must run no matter where
  // below this throws, not just on the happy path (this is nested inside
  // its own try/finally, separate from page's, specifically so a failure
  // in connectCdp() itself -- before `page` even exists to have its own
  // cleanup run -- still closes the server rather than leaking it).
  const server = await startStaticServer();
  try {
    const page = await connectCdp(browserBin);
    try {
      await runSmokeFlow(page);
    } finally {
      page.ws.close();
      page.child.kill();
    }
  } finally {
    server.close();
  }
}

async function runSmokeFlow(page) {
  await page.evalJs(
    `window.alert = (m) => { window.__alerts = window.__alerts || []; window.__alerts.push(m); };`,
  );
  await page.send("Page.navigate", {
    url: `http://localhost:${PORT}/?t=${Date.now()}`,
  });
  await new Promise((r) => setTimeout(r, 600));

  const hasElements = await page.evalJs(
    `!!(document.getElementById('newGameBtn') && document.getElementById('hand') && document.getElementById('drawPileBtn') && document.getElementById('layMeldBtn') && document.getElementById('discardBtn'))`,
  );
  if (!hasElements) {
    fail("expected page elements not found -- did docs/index.html change?");
    return;
  }

  const MAX_ATTEMPTS = 40;
  let meldIndices = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await clickSelector(page, "#newGameBtn");
    await new Promise((r) => setTimeout(r, 300));
    const humanTurnReady = await resolveTurn0IfPresent(page);
    if (!humanTurnReady) {
      fail(
        `attempt ${attempt}: drawPileBtn never became enabled -- Turn 0 / AI-first-turn handling may be broken, or the game genuinely stalled`,
      );
      return;
    }
    await clickSelector(page, "#drawPileBtn");
    await new Promise((r) => setTimeout(r, 200));
    const hand = await readHand(page);
    meldIndices = findSimpleMeldIndices(hand);
    if (meldIndices) break;
  }
  if (!meldIndices) {
    fail(
      `never dealt a hand with a plain (non-joker) meldable set/run in ${MAX_ATTEMPTS} attempts -- either very unlucky (expected ~99.9%+ success) or something broke`,
    );
    return;
  }

  const handBefore = await readHand(page);
  for (const idx of meldIndices) await clickHandCardAtIndex(page, idx);
  if (await isDisabled(page, "#layMeldBtn")) {
    fail(
      "layMeldBtn is still disabled after selecting 3 cards that should form a valid meld",
    );
    return;
  }
  await clickSelector(page, "#layMeldBtn");
  await new Promise((r) => setTimeout(r, 200));

  const alertsAfterMeld = await page.evalJs(`window.__alerts || []`);
  if (alertsAfterMeld.length > 0) {
    fail(
      `laying the meld triggered an error dialog: ${alertsAfterMeld.join("; ")}`,
    );
    return;
  }
  const handAfterMeld = await readHand(page);
  if (handAfterMeld.length !== handBefore.length - meldIndices.length) {
    fail(
      `expected hand to shrink by ${meldIndices.length} after laying the meld, went from ${handBefore.length} to ${handAfterMeld.length}`,
    );
    return;
  }
  const tableauHasMeld = await page.evalJs(
    `document.querySelectorAll('#tableau .card').length >= ${meldIndices.length}`,
  );
  if (!tableauHasMeld) {
    fail("tableau doesn't show the newly laid meld's cards");
    return;
  }

  // Discard: select the first remaining hand card and discard it.
  await clickHandCardAtIndex(page, 0);
  if (await isDisabled(page, "#discardBtn")) {
    fail("discardBtn is still disabled after selecting exactly one card");
    return;
  }
  const rowBefore = await page.evalJs(
    `document.querySelectorAll('#openRow .card').length`,
  );
  await clickSelector(page, "#discardBtn");
  await new Promise((r) => setTimeout(r, 300));
  const alertsAfterDiscard = await page.evalJs(`window.__alerts || []`);
  if (alertsAfterDiscard.length > 0) {
    fail(
      `discarding triggered an error dialog: ${alertsAfterDiscard.join("; ")}`,
    );
    return;
  }
  const rowAfter = await page.evalJs(
    `document.querySelectorAll('#openRow .card').length`,
  );
  if (rowAfter !== rowBefore + 1) {
    fail(
      `expected the open row to grow by 1 after discarding, went from ${rowBefore} to ${rowAfter}`,
    );
    return;
  }

  console.log(
    "OK: new game -> Turn 0 -> draw -> lay a meld -> discard, all via real clicks in headless Chromium.",
  );
}

main()
  .catch((e) => {
    fail(`unhandled error: ${e.stack || e.message}`);
  })
  .finally(() => {
    clearTimeout(watchdog); // ran to completion one way or another -- the safety net is no longer needed
  });
