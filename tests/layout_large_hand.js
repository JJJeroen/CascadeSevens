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

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";
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
  for (let i = 0; i < 50; i++) {
    if (await page.evalJs(`!!window.__cascadeTest`)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
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
      buttons: Array.from(root.querySelectorAll(".modal-actions button")).map(b => b.textContent),
      native: window.__nativeAlertCalled === true,
    };
  })()`);
  const tag = `${vp.name} dialog`;
  if (!d.open) fail(`${tag}: invalid meld didn't open the shared dialog`);
  else if (d.title !== "Can't do that" || d.buttons.join() !== "OK")
    fail(`${tag}: unexpected dialog content ${JSON.stringify(d)}`);
  await shot(page, `${vp.name}-dialog`);
  await page.evalJs(
    `document.querySelector("#dialogRoot .modal-actions button").click()`,
  );
  const closed = await page.evalJs(
    `document.querySelector("#dialogRoot").hidden`,
  );
  if (!closed) fail(`${tag}: OK didn't close the dialog`);
}

// Menu, Help dialog, and the dismiss-for-good hint balloon.
async function testChrome(page, vp) {
  const tag = `${vp.name} chrome`;
  const q = (js) => page.evalJs(js);
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.part = 1; g.round.current = 0;
    try { localStorage.removeItem("cascade.hintsSeen"); } catch {}
    window.__cascadeTest.render();
  })()`);
  const balloon = await q(`(() => {
    const b = document.querySelector("#balloon");
    return b.hidden ? null : b.textContent.trim();
  })()`);
  if (!balloon || !/pile/i.test(balloon))
    fail(
      `${tag}: expected the draw hint balloon, got ${JSON.stringify(balloon)}`,
    );
  await q(`document.querySelector("#balloonClose").click()`);
  await q(`window.__cascadeTest.render()`);
  const stillThere = await q(`!document.querySelector("#balloon").hidden`);
  if (stillThere) fail(`${tag}: dismissed hint came back after a re-render`);

  await q(`document.querySelector("#menuBtn").click()`);
  const items = await q(
    `Array.from(document.querySelectorAll("#menuPop button")).map(b => b.textContent)`,
  );
  const want = ["New", "Round 2", /^Goal /, "Help", /^Debug/];
  const ok = want.every((w, i) =>
    w instanceof RegExp ? w.test(items[i] ?? "") : items[i] === w,
  );
  if (!ok) fail(`${tag}: unexpected menu items ${JSON.stringify(items)}`);
  await q(`document.querySelector("#menuHelpBtn").click()`);
  const help = await q(`(() => {
    const r = document.querySelector("#dialogRoot");
    return { open: !r.hidden, title: r.querySelector(".dialog-title")?.textContent,
             menuClosed: document.querySelector("#menuPop").hidden };
  })()`);
  if (!help.open || help.title !== "How to play" || !help.menuClosed)
    fail(
      `${tag}: Help didn't open its dialog / close the menu: ${JSON.stringify(help)}`,
    );
  await q(`document.querySelector("#dialogRoot .x-btn").click()`);
  if (!(await q(`document.querySelector("#dialogRoot").hidden`)))
    fail(`${tag}: the dialog's X didn't close it`);

  const debugHidden = await q(`document.querySelector("#debugPanel").hidden`);
  if (!debugHidden) fail(`${tag}: debug panel should be hidden by default`);
  await q(`document.querySelector("#menuDebugBtn").click()`);
  if (await q(`document.querySelector("#debugPanel").hidden`))
    fail(`${tag}: menu -> Debug didn't show the debug panel`);
  await q(`document.querySelector("#menuDebugBtn").click()`);
}

// Round-end recap: this round's scores for both sides plus running totals,
// worded neutrally (the player who goes out doesn't always score more).
async function testRoundEnd(page, vp) {
  const tag = `${vp.name} round-end`;
  await page.evalJs(`(() => {
    const g = window.__cascadeTest.getGame();
    g.scores = [340, 420];
    Object.assign(g.round, { ended: true, roundWinner: 0, roundScores: [180, 185] });
    window.__cascadeTest.render();
  })()`);
  const d = await page.evalJs(`(() => {
    const m = document.querySelector("#modalRoot");
    return { open: !m.hidden, title: m.querySelector(".dialog-title")?.textContent,
             body: m.querySelector(".dialog-body")?.textContent,
             buttons: Array.from(m.querySelectorAll(".modal-actions button")).map(b => b.textContent) };
  })()`);
  const wantBody =
    "Your score this round: 180\nTheir score this round: 185\n\nTotal score — you: 340, AI: 420";
  if (!d.open || d.title !== "Round ended!" || d.body !== wantBody)
    fail(`${tag}: unexpected dialog ${JSON.stringify(d)}`);
  if (d.buttons.join() !== "Round 2,New game")
    fail(`${tag}: unexpected buttons ${JSON.stringify(d.buttons)}`);
}

// After taking from the open row the player must press "Done drawing"; make
// sure the screen says so and that an early tap on a card explains itself.
async function testDoneDrawing(page, vp) {
  const tag = `${vp.name} done-drawing`;
  const q = (js) => page.evalJs(js);
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.part = 1; g.round.current = 0; g.round.rowDrawsThisPart1 = 1;
    window.__t.setHand(9);
    window.__t.setTableau([]);
    try { localStorage.removeItem("cascade.hintsSeen"); } catch {}
    window.__cascadeTest.render();
  })()`);
  const s = await q(`(() => {
    const b = document.querySelector("#finishDrawingBtn");
    const bl = document.querySelector("#balloon");
    return { btnVisible: !b.hidden && b.getBoundingClientRect().height > 0,
             btnClass: b.className, balloon: bl.hidden ? null : bl.textContent.trim() };
  })()`);
  if (!s.btnVisible || !s.btnClass.includes("cta"))
    fail(
      `${tag}: "Done drawing" should be visible and prominent: ${JSON.stringify(s)}`,
    );
  if (!s.balloon || !/Done drawing/.test(s.balloon))
    fail(
      `${tag}: expected a balloon pointing at Done drawing, got ${JSON.stringify(s.balloon)}`,
    );
  await q(`document.querySelector("#balloonClose").click()`);
  await q(`document.querySelector("#hand .card").click()`);
  const tapped = await q(
    `document.querySelector("#balloon").textContent.trim()`,
  );
  if (!/Done drawing/.test(tapped))
    fail(
      `${tag}: tapping a card early should explain; got ${JSON.stringify(tapped)}`,
    );
}

// Opponent's come-out progress next to the round label.
async function testOppStatus(page, vp) {
  const tag = `${vp.name} opp-status`;
  const q = (js) => page.evalJs(js);
  const read = () =>
    q(
      `(() => { const e = document.querySelector("#oppStatus"); return e.hidden ? null : e.textContent; })()`,
    );
  await q(
    `(() => { const r = window.__cascadeTest.getGame().round; r.part = 2; r.current = 1; r.comeOut[1] = false; r.comeOutAccum[1] = 0; window.__cascadeTest.render(); })()`,
  );
  if ((await read()) !== null) fail(`${tag}: should be hidden before any meld`);
  await q(
    `(() => { const r = window.__cascadeTest.getGame().round; r.comeOutAccum[1] = 35; window.__cascadeTest.render(); })()`,
  );
  if ((await read()) !== null)
    fail(`${tag}: progress below 40 is no longer shown, got ${await read()}`);
  await q(
    `(() => { const r = window.__cascadeTest.getGame().round; r.comeOut[1] = true; window.__cascadeTest.render(); })()`,
  );
  if ((await read()) !== "out")
    fail(`${tag}: expected "out", got ${await read()}`);
}

// Under-40 come-out: ending the turn with under 40 on the table opens the
// popup; "Keep laying" leaves everything, "Take back" returns the cards.
async function testSub40Popup(page, vp) {
  const tag = `${vp.name} sub40`;
  const q = (js) => page.evalJs(js);
  const state = () =>
    q(`(() => ({
      hand: document.querySelectorAll("#hand .card").length,
      table: document.querySelectorAll("#tableau .card").length,
      open: !document.querySelector("#dialogRoot").hidden,
      title: document.querySelector("#dialogRoot .dialog-title")?.textContent ?? null,
      body: document.querySelector("#dialogRoot .dialog-body")?.textContent ?? null,
    }))()`);
  // fresh game first: it clears selections left over from tests that poke state
  await q(`document.querySelector("#newGameBtn").click()`);
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    const r = g.round;
    r.part = 2; r.current = 0; r.ended = false; r.pendingObligations = []; r.rowObligationCardId = null;
    r.comeOut[0] = false; r.comeOutAccum[0] = 0; r.comeOutAttempt = null;
    r.hands[0] = ["QS","QH","QD","2C","5D","9H","3S"].map((id) => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) }));
    r.tableau = [];
    window.__cascadeTest.render();
  })()`);
  const click = async (sel, i = 0) => {
    const ok = await q(`(() => {
      const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}];
      if (!e) return false;
      e.click();
      return true;
    })()`);
    if (!ok) throw new Error(`${tag}: nothing to click for ${sel} [${i}]`);
  };
  // by card id: the hand's display order carries over from earlier tests
  const byId = (id) => `#hand .card[data-card-id="${id}"]`;
  for (const id of ["QS", "QH", "QD"]) await click(byId(id));
  await click("#layMeldBtn");
  const laid = await state();
  if (laid.table !== 3 || laid.hand !== 4)
    return fail(
      `${tag}: expected the 30-point meld on the table, got ${JSON.stringify(laid)}`,
    );
  await click(byId("2C"));
  await click("#discardBtn");
  let st = await state();
  if (!st.open || !/lay 40 or more/.test(st.title ?? ""))
    return fail(
      `${tag}: ending the turn at 30 should open the popup, got ${JSON.stringify(st)}`,
    );
  await click("#dialogRoot .modal-actions button", 0); // Keep laying
  st = await state();
  if (st.open || st.table !== 3 || st.hand !== 4)
    fail(`${tag}: "Keep laying" should change nothing: ${JSON.stringify(st)}`);
  // 2C is still selected from the first attempt (selecting again would toggle it off)
  await click("#discardBtn");
  await click("#dialogRoot .modal-actions button", 1); // Take back
  st = await state();
  if (st.open || st.table !== 0 || st.hand !== 7)
    fail(
      `${tag}: "Take back" should return all 3 cards: ${JSON.stringify(st)}`,
    );
}

async function main() {
  const browserBin = findBrowser();
  if (!browserBin) {
    console.log("SKIP: no Chromium/Chrome binary found on PATH");
    return;
  }
  const server = await startStaticServer(PORT);
  let page = null;
  try {
    page = await connect(browserBin, CDP_PORT);
    for (const vp of VIEWPORTS) {
      console.log(`${vp.name} (${vp.width}x${vp.height})`);
      await openPage(page, vp);
      await testHands(page, vp);
      await testTableau(page, vp);
      await testDialog(page, vp);
      await testChrome(page, vp);
      await testDoneDrawing(page, vp);
      await testOppStatus(page, vp);
      await testSub40Popup(page, vp);
      await testRoundEnd(page, vp); // last: it leaves the round marked ended
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
