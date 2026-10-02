// Browser layout test for extreme positions: big hands, long melds, many
// melds, and the shared dialog -- the cases random play rarely reaches and
// that the compact-meld / wrapping-hand CSS was written for. Drives the real
// compiled docs/ page in headless Chromium over CDP (same technique as
// smoke_browser.js), using the page's ?test=1 hook to put the real game in
// the position under test, then measures the real rendered layout.
//
// Checks, at several phone/tablet viewport widths:
//   - hand: every card keeps >= 44px of its width visible (the minimum
//     tappable strip), nothing overflows the page sideways, and a hand that
//     doesn't fit wraps to more rows instead of squeezing or scrolling
//   - tableau: meld cards keep a readable strip, no meld is wider than the
//     table (long runs tighten their overlap), melds scroll rather than
//     overflow the page
//   - dialog: an invalid action opens the shared dialog and OK closes it
//
// Set SHOTS_DIR=/some/dir to also save a screenshot per scenario.
// Needs Chromium/Chrome on PATH and Node >= 22 (global WebSocket).

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, "..", "docs");
const PORT = 8792;
const CDP_PORT = 9823;
const SHOTS_DIR = process.env.SHOTS_DIR;
const MIN_HAND_STRIP = 44;
const MIN_MELD_STRIP = 17;
const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 640 },
  { name: "phone-360", width: 360, height: 740 },
  { name: "phone-412", width: 412, height: 915 },
  { name: "tablet-768", width: 768, height: 1024 },
];
const HAND_SIZES = [7, 13, 20, 30];

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`FAIL: ${msg}`);
}

function findBrowser() {
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

function startStaticServer() {
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
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function connect(browserBin) {
  const child = spawn(
    browserBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${CDP_PORT}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        target = await (
          await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
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

// Page-side helpers, injected once per load. Builds real engine-shaped state.
const PAGE_HELPERS = `
  window.__t = (() => {
    const T = window.__cascadeTest;
    const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    const SUITS = ["S","H","D","C"];
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ id: r + s, rank: r, suit: s });
    return {
      deck,
      setHand(n) {
        const g = T.getGame();
        g.round.hands[0] = deck.slice(0, n).map(c => ({ ...c }));
        T.render();
      },
      run(id, suit, from, to, wildAt) {
        const slots = [];
        for (let i = from; i <= to; i++) {
          const wild = i === wildAt;
          slots.push({
            card: wild ? { id: "JK" + id, rank: "JOKER", suit: null } : { id: RANKS[i] + suit + id, rank: RANKS[i], suit },
            ownerId: i % 2,
            wildAs: wild ? { rank: RANKS[i], suit } : null,
          });
        }
        return { id, type: "run", slots };
      },
      set(id, rank, suits) {
        return {
          id, type: "set",
          slots: suits.map((s, i) => ({ card: { id: rank + s + id, rank, suit: s }, ownerId: i % 2, wildAs: null })),
        };
      },
      setTableau(melds) {
        const g = T.getGame();
        g.round.tableau = melds;
        T.render();
      },
    };
  })();
`;

async function openPage(page, vp) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page.send("Page.navigate", {
    url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evalJs(`window.__cascadeTest.disableAI()`);
  await page.evalJs(PAGE_HELPERS);
}

async function shot(page, name) {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  const r = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    path.join(SHOTS_DIR, `${name}.png`),
    Buffer.from(r.result.data, "base64"),
  );
}

// For each card, how much of it stays visible = distance to the next card in
// the same row (cards in the same row share a top edge).
const STRIP_MEASURE = (containerSel, cardSel) => `(() => {
  const box = document.querySelector(${JSON.stringify(containerSel)});
  const cards = Array.from(box.querySelectorAll(${JSON.stringify(cardSel)}));
  const boxRect = box.getBoundingClientRect();
  let minStrip = Infinity, outside = 0;
  const tops = new Set();
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    tops.add(Math.round(r.top));
    if (r.right > boxRect.right + 0.5 || r.left < boxRect.left - 0.5) outside++;
    const n = cards[i + 1];
    if (n) {
      const nr = n.getBoundingClientRect();
      if (Math.abs(nr.top - r.top) < 3) minStrip = Math.min(minStrip, nr.left - r.left);
    }
  });
  return {
    count: cards.length, minStrip: minStrip === Infinity ? null : Math.round(minStrip * 10) / 10,
    outside, rows: tops.size, height: Math.round(boxRect.height),
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

async function testHands(page, vp) {
  for (const n of HAND_SIZES) {
    await page.evalJs(`window.__t.setHand(${n})`);
    const m = await page.evalJs(STRIP_MEASURE("#hand", ".card"));
    const tag = `${vp.name} hand=${n}`;
    console.log(
      `  ${tag}: rows=${m.rows} minStrip=${m.minStrip}px handHeight=${m.height}px`,
    );
    if (m.count !== n) fail(`${tag}: rendered ${m.count} cards, expected ${n}`);
    if (m.minStrip !== null && m.minStrip < MIN_HAND_STRIP - 0.5)
      fail(`${tag}: card strip ${m.minStrip}px < ${MIN_HAND_STRIP}px`);
    if (m.outside > 0) fail(`${tag}: ${m.outside} cards outside the hand box`);
    if (m.pageOverflow > 0)
      fail(`${tag}: page overflows sideways by ${m.pageOverflow}px`);
    if (n === 7 && vp.width >= 360 && m.rows !== 1)
      fail(`${tag}: a normal 7-card hand should fit one row, got ${m.rows}`);
    if (n >= 20 && m.rows < 2)
      fail(`${tag}: expected the hand to wrap to >1 row`);
    if (n === 30) await shot(page, `${vp.name}-hand-30`);
  }
}

async function testTableau(page, vp) {
  const T = (s) => page.evalJs(s);
  await T(`window.__t.setHand(14)`);
  // worst case: a full 13-card run, a 14-card run with a joker standing in,
  // plus a spread of sets and shorter runs -- 8 melds, ~40 cards
  await T(`window.__t.setTableau([
    window.__t.run("m1","H",0,12),
    window.__t.run("m2","S",0,12,6),
    window.__t.set("m3","7",["S","H","D","C"]),
    window.__t.set("m4","K",["S","H","D"]),
    window.__t.run("m5","D",2,6),
    window.__t.run("m6","C",8,12),
    window.__t.set("m7","3",["S","H","D"]),
    window.__t.set("m8","Q",["H","D","C"]),
  ])`);
  const info = await T(`(() => {
    const tab = document.querySelector("#tableau");
    const out = [];
    document.querySelectorAll("#tableau .meld").forEach(box => {
      const cards = Array.from(box.querySelectorAll(".card"));
      let minStrip = Infinity;
      cards.forEach((c, i) => {
        const n = cards[i + 1];
        if (n) minStrip = Math.min(minStrip, n.getBoundingClientRect().left - c.getBoundingClientRect().left);
      });
      out.push({
        id: box.dataset.meldId, n: cards.length,
        minStrip: minStrip === Infinity ? null : Math.round(minStrip * 10) / 10,
        wider: Math.round(box.getBoundingClientRect().width - tab.clientWidth),
      });
    });
    return { melds: out, pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
             tableauScrollX: tab.scrollWidth - tab.clientWidth, tableauHeight: tab.clientHeight };
  })()`);
  const tag = `${vp.name} tableau`;
  console.log(
    `  ${tag}: ${info.melds.map((m) => `${m.n}c/strip ${m.minStrip}`).join(", ")}; table height ${info.tableauHeight}px`,
  );
  info.melds.forEach((m) => {
    if (m.minStrip !== null && m.minStrip < MIN_MELD_STRIP - 0.5)
      fail(
        `${tag}: meld ${m.id} (${m.n} cards) strip ${m.minStrip}px < ${MIN_MELD_STRIP}px`,
      );
    if (m.wider > 0)
      fail(`${tag}: meld ${m.id} is ${m.wider}px wider than the table`);
  });
  if (info.tableauScrollX > 1)
    fail(`${tag}: table scrolls sideways by ${info.tableauScrollX}px`);
  if (info.pageOverflow > 0)
    fail(`${tag}: page overflows sideways by ${info.pageOverflow}px`);
  await shot(page, `${vp.name}-tableau-8-melds`);
}

async function testDialog(page, vp) {
  // Select 3 cards that can't form a meld during Part 2, then try to lay
  // them: the engine rejects it and the shared dialog must appear.
  await page.evalJs(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.part = 2; g.round.current = 0;
    window.__t.setHand(14);
    window.__t.setTableau([]);
  })()`);
  await page.evalJs(`(() => {
    const cs = document.querySelectorAll("#hand .card");
    [0, 4, 8].forEach(i => cs[i].click());
  })()`);
  await page.evalJs(`document.querySelector("#layMeldBtn").click()`);
  await new Promise((r) => setTimeout(r, 100));
  const d = await page.evalJs(`(() => {
    const root = document.querySelector("#dialogRoot");
    return {
      open: !root.hidden,
      title: root.querySelector(".dialog-title")?.textContent ?? null,
      buttons: Array.from(root.querySelectorAll("button")).map(b => b.textContent),
      native: window.__nativeAlertCalled === true,
    };
  })()`);
  const tag = `${vp.name} dialog`;
  if (!d.open) fail(`${tag}: invalid meld didn't open the shared dialog`);
  else if (d.title !== "Can't do that" || d.buttons.join() !== "OK")
    fail(`${tag}: unexpected dialog content ${JSON.stringify(d)}`);
  await shot(page, `${vp.name}-dialog`);
  await page.evalJs(`document.querySelector("#dialogRoot button").click()`);
  const closed = await page.evalJs(
    `document.querySelector("#dialogRoot").hidden`,
  );
  if (!closed) fail(`${tag}: OK didn't close the dialog`);
}

async function main() {
  const browserBin = findBrowser();
  if (!browserBin) {
    console.log("SKIP: no Chromium/Chrome binary found on PATH");
    return;
  }
  const server = await startStaticServer();
  let page = null;
  try {
    page = await connect(browserBin);
    for (const vp of VIEWPORTS) {
      console.log(`${vp.name} (${vp.width}x${vp.height})`);
      await openPage(page, vp);
      await testHands(page, vp);
      await testTableau(page, vp);
      await testDialog(page, vp);
    }
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failures > 0) {
    console.log(`${failures} layout check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("OK: all layout checks passed");
  }
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
