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
  const want = ["New", "Round 2", /^Goal /, /^Opponent: /, "Help", /^Debug/];
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

// Round-end recap: this round's scores for both sides (the running totals are
// already in the screen corners),
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
  const wantBody = "Your score this round: 180\nTheir score this round: 185";
  if (!d.open || d.title !== "Round ended!" || d.body !== wantBody)
    fail(`${tag}: unexpected dialog ${JSON.stringify(d)}`);
  if (d.buttons.join() !== "Round 2,New game")
    fail(`${tag}: unexpected buttons ${JSON.stringify(d.buttons)}`);
  // A round that ends because the pile ran empty says so in the title.
  const t2 = await page.evalJs(`(() => {
    window.__cascadeTest.getGame().round.endReason = "pile-empty";
    window.__cascadeTest.render();
    return document.querySelector("#modalRoot .dialog-title")?.textContent;
  })()`);
  if (t2 !== "Round ended, pile empty")
    fail(`${tag}: pile-empty title was ${JSON.stringify(t2)}`);
}

// Take, lay, take again: after a cascade take there is no "Done drawing" step,
// and the cascade stays tappable in Part 2 (the pile does not).
async function testDoneDrawing(page, vp) {
  const tag = `${vp.name} take-again`;
  const q = (js) => page.evalJs(js);
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.part = 2; g.round.current = 0; g.round.rowDrawsThisPart1 = 1;
    window.__t.setHand(9);
    window.__t.setTableau([]);
    window.__cascadeTest.render();
  })()`);
  const s = await q(`(() => ({
    finishBtn: !!document.querySelector("#finishDrawingBtn"),
    cards: document.querySelectorAll("#openRow .card").length,
    pickable: document.querySelectorAll("#openRow .card.pickable").length,
  }))()`);
  if (s.finishBtn) fail(`${tag}: "Done drawing" should be gone`);
  if (s.cards > 0 && s.pickable !== s.cards)
    fail(
      `${tag}: cascade cards should stay tappable in Part 2: ${JSON.stringify(s)}`,
    );
}

// A targeted series that disappears must not keep "Pull my cards" enabled.
async function testStaleTarget(page, vp) {
  const tag = `${vp.name} stale-target`;
  const q = (js) => page.evalJs(js);
  await q(`(() => {
    const r = window.__cascadeTest.getGame().round;
    r.part = 2; r.current = 0; r.ended = false; r.comeOut[0] = true; r.rearrange = null;
    window.__t.setHand(5);
    window.__t.setTableau([window.__t.run("m1", "H", 0, 4)]);
    document.querySelector("#tableau .meld").click();
  })()`);
  const shown = () =>
    q(
      `(() => { const b = document.querySelector("#pullMeldBtn"); return !b.hidden; })()`,
    );
  if (!(await shown()))
    fail(`${tag}: precondition: Pull should show while a series is targeted`);
  await q(`window.__t.setTableau([])`);
  if (await shown())
    fail(`${tag}: Pull must hide once the targeted series is gone`);
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

// Turn 0 by tapping: open card = take it (then pick a hand card), pile =
// decline. A hint balloon explains it.
async function testTurn0(page, vp) {
  const tag = `${vp.name} turn0`;
  const q = (js) => page.evalJs(js);
  // New games until the human is the one asked (AI is switched off here).
  let mine = false;
  for (let i = 0; i < 30 && !mine; i++) {
    await q(`document.querySelector("#newGameBtn").click()`);
    mine = await q(
      `window.__cascadeTest.getGame().round.part === "turn0" && window.__cascadeTest.turn0Askee() === 0`,
    );
  }
  if (!mine)
    return fail(`${tag}: never got a game where the human is asked first`);
  await q(
    `try { localStorage.removeItem("cascade.hintsSeen"); } catch {} window.__cascadeTest.render()`,
  );
  const bal = () =>
    q(
      `(() => { const b = document.querySelector("#balloon"); return b.hidden ? null : b.textContent.trim(); })()`,
    );
  if (!/tap the open card/i.test((await bal()) ?? ""))
    fail(
      `${tag}: expected the Turn 0 hint, got ${JSON.stringify(await bal())}`,
    );
  const buttons = await q(
    `Array.from(document.querySelectorAll("#banner button")).length`,
  );
  if (buttons !== 0) fail(`${tag}: Take/Decline buttons should be gone`);
  // tap the open card -> asks for a hand card
  await q(`document.querySelector("#openRow .card").click()`);
  if (!/tap the card from your hand/i.test((await bal()) ?? ""))
    fail(
      `${tag}: expected the place-a-card prompt, got ${JSON.stringify(await bal())}`,
    );
  // tap it again -> back to the offer
  await q(`document.querySelector("#openRow .card").click()`);
  if (!/tap the open card/i.test((await bal()) ?? ""))
    fail(`${tag}: tapping the open card again should cancel the swap`);
  // take it and place a hand card -> the offer is resolved (swap done)
  await q(`document.querySelector("#openRow .card").click()`);
  await q(`document.querySelector("#hand .card").click()`);
  const after = await q(
    `window.__cascadeTest.getGame().round.part === "turn0" ? window.__cascadeTest.turn0Askee() : "done"`,
  );
  if (after === 0)
    fail(`${tag}: swapping a hand card in should resolve the human's offer`);
  // fresh game, decline by tapping the pile
  mine = false;
  for (let i = 0; i < 30 && !mine; i++) {
    await q(`document.querySelector("#newGameBtn").click()`);
    mine = await q(
      `window.__cascadeTest.getGame().round.part === "turn0" && window.__cascadeTest.turn0Askee() === 0`,
    );
  }
  await q(`document.querySelector("#pileBtn").click()`);
  const declined = await q(
    `window.__cascadeTest.getGame().round.part === "turn0" ? window.__cascadeTest.turn0Askee() : "done"`,
  );
  if (declined === 0) fail(`${tag}: tapping the pile should decline the offer`);
}

// The log (debug panel) shows the NEWEST lines, scrolled to the bottom, in the
// app's own words: "You" / "The AI", not "Player 1" / "Player 2".
async function testLog(page, vp) {
  const tag = `${vp.name} log`;
  const q = (js) => page.evalJs(js);
  await q(`document.querySelector("#menuDebugBtn").click()`); // show the debug panel
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.log = Array.from({ length: 30 }, (_, i) => "Player " + (i % 2 + 1) + " did thing " + (i + 1) + ".");
    g.round.log.push("Round over (handout). Round scores: P1 80, P2 75. Totals: P1 200, P2 300.");
    window.__cascadeTest.render();
  })()`);
  const s = await q(`(() => {
    const el = document.querySelector("#log");
    const last = el.lastElementChild.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { text: el.lastElementChild.textContent, first: el.firstElementChild.textContent,
             lastVisible: last.bottom <= box.bottom + 1 && last.top >= box.top - 1,
             firstVisible: el.firstElementChild.getBoundingClientRect().bottom > box.top + 1 };
  })()`);
  if (!s.lastVisible) fail(`${tag}: the newest log line should be in view`);
  if (s.firstVisible)
    fail(`${tag}: with 31 lines the oldest should be scrolled out of view`);
  if (
    s.text !==
    "Round over (handout). Round scores: you 80, the AI 75. Totals: you 200, the AI 300."
  )
    fail(`${tag}: unexpected wording: ${JSON.stringify(s.text)}`);
  if (/Player [12]/.test(s.first))
    fail(`${tag}: "Player N" should read You / The AI`);
  // the joker-swap line names whose series it was and who keeps the card
  await q(`(() => {
    const g = window.__cascadeTest.getGame();
    g.round.log = ["Player 1 swapped a joker out of Player 2's series for 7D (it stays with Player 2)."];
    window.__cascadeTest.render();
  })()`);
  const swapLine = await q(
    `document.querySelector("#log").lastElementChild.textContent`,
  );
  if (
    swapLine !==
    "You swapped a joker out of The AI's series for 7D (it stays with the AI)."
  )
    fail(`${tag}: unexpected swap log wording: ${JSON.stringify(swapLine)}`);
  await q(`document.querySelector("#menuDebugBtn").click()`); // hide it again
}

// The round-end popup can be dragged out of the way, stays on screen, and
// doesn't dim or block the table underneath (Tommer: "he can't see what
// happened since the popup sits over it").
async function testMovablePopup(page, vp) {
  const tag = `${vp.name} movable-popup`;
  const q = (js) => page.evalJs(js);
  const rect = () =>
    q(
      `(() => { const r = document.querySelector("#modalBox").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`,
    );
  const info = await q(`(() => {
    const root = getComputedStyle(document.querySelector("#modalRoot"));
    const outside = document.elementFromPoint(5, window.innerHeight - 5);
    return { pe: root.pointerEvents, bg: root.backgroundColor,
             open: !document.querySelector("#modalRoot").hidden,
             tableReachable: !!outside && !outside.closest("#modalRoot") };
  })()`);
  if (!info.open) return fail(`${tag}: the round-end popup should be open`);
  if (info.pe !== "none")
    fail(
      `${tag}: the popup backdrop must not block the page (pointer-events ${info.pe})`,
    );
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(info.bg))
    fail(`${tag}: the popup backdrop should not dim the table (${info.bg})`);
  if (!info.tableReachable)
    fail(`${tag}: the table outside the popup should be reachable`);

  const send = (type, x, y) =>
    page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
    });
  const drag = async (from, to) => {
    await send("mouseMoved", from.x, from.y);
    await send("mousePressed", from.x, from.y);
    for (let i = 1; i <= 6; i++)
      await send(
        "mouseMoved",
        from.x + ((to.x - from.x) * i) / 6,
        from.y + ((to.y - from.y) * i) / 6,
      );
    await send("mouseReleased", to.x, to.y);
  };
  const before = await rect();
  const grab = { x: before.l + 14, y: before.t + 10 }; // the handle / padding, not a button
  await drag(grab, { x: grab.x + 10, y: grab.y - 30 }); // phones leave only ~16px of sideways room
  const moved = await rect();
  if (
    Math.abs(moved.l - before.l - 10) > 2 ||
    Math.abs(moved.t - before.t + 30) > 2
  )
    fail(
      `${tag}: dragging by (10,-30) moved the popup by (${Math.round(moved.l - before.l)},${Math.round(moved.t - before.t)})`,
    );

  // yank it far off the screen: it must stay fully visible
  const g2 = { x: moved.l + 14, y: moved.t + 10 };
  await drag(g2, { x: g2.x - 3000, y: g2.y - 3000 });
  const far = await rect();
  const vw = await q(`window.innerWidth`);
  const vh = await q(`window.innerHeight`);
  if (far.r > vw + 1 || far.b > vh + 1 || far.l < -1 || far.t < -1)
    fail(
      `${tag}: the popup left the screen: ${JSON.stringify(far)} in ${vw}x${vh}`,
    );
  if (far.t >= moved.t)
    fail(
      `${tag}: dragging far up should have moved it up (${moved.t} -> ${far.t})`,
    );
}

// A card you can't pull back (the AI's, or you haven't come out yet) must say
// why when you hold or drag it, instead of silently not moving.
async function testBlockedPullHint(page, vp) {
  const tag = `${vp.name} blocked-pull`;
  const q = (js) => page.evalJs(js);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await q(`document.querySelector("#newGameBtn").click()`);
  const setup = (comeOut) =>
    q(`(() => {
    const g = window.__cascadeTest.getGame(), r = g.round;
    r.part = 2; r.current = 0; r.ended = false; r.comeOut[0] = ${comeOut}; r.comeOutAccum = [0, 0];
    r.pendingObligations = []; r.rowObligationCardId = null; r.rearrange = null; r.comeOutAttempt = null;
    const c = (rank, suit) => ({ id: rank + suit, rank, suit });
    r.hands[0] = [c("K","D"), c("2","C"), c("9","S")];
    r.tableau = [{ id: "ai", type: "set", slots: ["S","H","D"].map((s) => ({ card: c("Q", s), ownerId: 1, wildAs: null })) }];
    document.querySelector("#balloonClose")?.click();
    window.__cascadeTest.render();
  })()`);
  const balloon = () =>
    q(
      `(() => { const b = document.querySelector("#balloon"); return b.hidden ? null : b.textContent.trim(); })()`,
    );
  const send = (type, x, y) =>
    page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
    });
  const cardPoint = () =>
    q(
      `(() => { const r = document.querySelector('#tableau .card[data-card-id="QD"]').getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; })()`,
    );

  await setup(true);
  // mouse drag, no hold
  let p = await cardPoint();
  await send("mouseMoved", p.x, p.y);
  await send("mousePressed", p.x, p.y);
  await send("mouseMoved", p.x + 30, p.y + 60);
  await send("mouseReleased", p.x + 30, p.y + 60);
  let b = await balloon();
  if (!b || !/counts for the AI/.test(b) || !/Rearrange/.test(b))
    fail(
      `${tag}: dragging the AI's card should explain why, got ${JSON.stringify(b)}`,
    );

  // press and hold, no movement
  await setup(true);
  p = await cardPoint();
  await send("mouseMoved", p.x, p.y);
  await send("mousePressed", p.x, p.y);
  await sleep(400);
  await send("mouseReleased", p.x, p.y);
  b = await balloon();
  if (!b || !/counts for the AI/.test(b))
    fail(
      `${tag}: holding the AI's card should explain why, got ${JSON.stringify(b)}`,
    );

  // not come out yet
  await setup(false);
  p = await cardPoint();
  await send("mouseMoved", p.x, p.y);
  await send("mousePressed", p.x, p.y);
  await sleep(400);
  await send("mouseReleased", p.x, p.y);
  b = await balloon();
  if (!b || !/after you've come out/.test(b))
    fail(
      `${tag}: before coming out it should say so, got ${JSON.stringify(b)}`,
    );

  // a plain tap still just targets the series, with no hint
  await setup(true);
  p = await cardPoint();
  await send("mouseMoved", p.x, p.y);
  await send("mousePressed", p.x, p.y);
  await send("mouseReleased", p.x, p.y);
  b = await balloon();
  if (b && /counts for the AI/.test(b))
    fail(`${tag}: a plain tap should not show the hint`);
}

// Who scores a card is shown by a coloured bar along its bottom edge (orange =
// you, blue = the AI) and the two scores use the same colours.
async function testOwnerColors(page, vp) {
  const tag = `${vp.name} owner-colors`;
  const q = (js) => page.evalJs(js);
  const YOU = "rgb(255, 179, 71)";
  const THEM = "rgb(90, 169, 255)";
  await q(`window.__t.setHand(5)`);
  // the helper alternates owners: card 0 -> you, card 1 -> the AI, ...
  await q(`window.__t.setTableau([window.__t.run("o1", "H", 0, 3)])`);
  const s = await q(`(() => {
    const shadow = (el) => getComputedStyle(el).boxShadow;
    const cards = document.querySelectorAll("#tableau .card");
    return {
      first: shadow(cards[0]), second: shadow(cards[1]),
      hand: shadow(document.querySelector("#hand .card")),
      score1: getComputedStyle(document.querySelector("#scoreP1")).color,
      score2: getComputedStyle(document.querySelector("#scoreP2")).color,
    };
  })()`);
  if (!s.first.includes(YOU))
    fail(`${tag}: your card should have the orange bar, got ${s.first}`);
  if (!s.second.includes(THEM))
    fail(`${tag}: the AI's card should have the blue bar, got ${s.second}`);
  if (!s.hand.includes(YOU))
    fail(`${tag}: your hand cards should have the orange bar, got ${s.hand}`);
  if (s.score1 !== YOU)
    fail(`${tag}: your score should be orange, got ${s.score1}`);
  if (s.score2 !== THEM)
    fail(`${tag}: the AI's score should be blue, got ${s.score2}`);
}

// A joker you owe after a swap: "You must use this joker in this turn" (not
// "You must lay JOKER in a series").
async function testJokerObligation(page, vp) {
  const tag = `${vp.name} joker-obligation`;
  const q = (js) => page.evalJs(js);
  await q(`document.querySelector("#newGameBtn").click()`);
  await q(`(() => {
    const g = window.__cascadeTest.getGame(), r = g.round;
    r.part = 2; r.current = 0; r.ended = false; r.rearrange = null;
    r.comeOut[0] = true; r.comeOutAccum = [0, 0]; r.comeOutAttempt = null;
    r.rowObligationCardId = null; r.pendingObligations = ["JOKER1"];
    r.hands[0] = [{ id: "JOKER1", rank: "JOKER", suit: null }, { id: "2C", rank: "2", suit: "C" }, { id: "9S", rank: "9", suit: "S" }];
    r.tableau = [];
    window.__cascadeTest.render();
  })()`);
  const s = await q(`(() => ({
    balloon: document.querySelector("#balloon").hidden ? null : document.querySelector("#balloonText").textContent,
    label: document.querySelector("#obligationLabel").hidden ? null : document.querySelector("#obligationLabel").textContent,
  }))()`);
  if (s.balloon !== "You must use this joker in this turn")
    fail(`${tag}: unexpected balloon ${JSON.stringify(s.balloon)}`);
  if (
    !s.label ||
    !/Joker \(you must use it this turn\)/.test(s.label) ||
    /JOKER/.test(s.label)
  )
    fail(`${tag}: unexpected status text ${JSON.stringify(s.label)}`);
}

// Both total scores live in the screen corners: the AI's top right, yours
// bottom right -- with or without the opponent's "out" badge showing.
async function testCornerScores(page, vp) {
  const tag = `${vp.name} corner-scores`;
  const q = (js) => page.evalJs(js);
  const corners = () =>
    q(`(() => {
      const w = window.innerWidth;
      const a = document.querySelector("#scoreP2").getBoundingClientRect();
      const y = document.querySelector("#scoreP1").getBoundingClientRect();
      return { aiGap: Math.round(w - a.right), youGap: Math.round(w - y.right), aiTop: Math.round(a.top) };
    })()`);
  for (const out of [false, true]) {
    await q(`(() => {
      const r = window.__cascadeTest.getGame().round;
      r.ended = false; r.comeOut[1] = ${out};
      window.__cascadeTest.render();
    })()`);
    const c = await corners();
    const what = out ? "with the out badge" : "without the out badge";
    if (c.aiGap > 24)
      fail(
        `${tag}: the AI's total should sit in the top-right corner ${what} (${c.aiGap}px from the edge)`,
      );
    if (c.youGap > 24)
      fail(
        `${tag}: your total should sit in the bottom-right corner ${what} (${c.youGap}px from the edge)`,
      );
  }
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
      await testOwnerColors(page, vp);
      await testCornerScores(page, vp);
      await testDialog(page, vp);
      await testChrome(page, vp);
      await testDoneDrawing(page, vp);
      await testOppStatus(page, vp);
      await testLog(page, vp);
      await testSub40Popup(page, vp);
      await testTurn0(page, vp);
      await testBlockedPullHint(page, vp);
      await testJokerObligation(page, vp);
      await testStaleTarget(page, vp);
      await testRoundEnd(page, vp); // leaves the round marked ended...
      await testMovablePopup(page, vp); // ...which this one needs
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
