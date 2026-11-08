// Adding several selected cards to a series: a card the engine refuses is not
// counted as added -- it stays selected and the engine's reason is shown.
// Before, a refused card was dropped from the selection without a word.
// Case: run 4-5-6H on the table, hand 3H 7H, both selected, "Add to series":
// 3H goes in, 7H would empty the hand, so the engine refuses it.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8802;
const CDP_PORT = 9833;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => {
  console.log(`FAIL: ${m}`);
  failed = true;
  process.exitCode = 1;
};

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
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const q = (js) => page.evalJs(js);
    await page.send("Page.navigate", {
      url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
    });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await q(`!!window.__cascadeTest?.getGame()`).catch(() => false))
        break;
    }
    await q(`window.__cascadeTest.disableAI()`);
    await q(`(() => {
      const c = (id, rank, suit) => ({ id, rank, suit });
      const r = window.__cascadeTest.getGame().round;
      r.part = 2; r.current = 0; r.ended = false; r.rearrange = null;
      r.comeOut = [true, true]; r.pendingObligations = []; r.rowObligationCardId = null;
      r.lastDraw = null; r.comeOutAttempt = null; r.undoStack = [];
      r.tableau = [{ id: "m1", type: "run", slots: [
        { card: c("4H","4","H"), ownerId: 1, wildAs: null },
        { card: c("5H","5","H"), ownerId: 1, wildAs: null },
        { card: c("6H","6","H"), ownerId: 1, wildAs: null } ] }];
      r.hands[0] = [c("3H","3","H"), c("7H","7","H")];
      window.__cascadeTest.render();
    })()`);
    const tap = (sel) =>
      q(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await tap('.meld[data-meld-id="m1"]');
    await tap('#hand .card[data-card-id="3H"]');
    await tap('#hand .card[data-card-id="7H"]');
    await tap("#addToMeldBtn");
    await sleep(100);
    const s = await q(`(() => {
      const r = window.__cascadeTest.getGame().round;
      const root = document.querySelector("#dialogRoot");
      const sevenEl = document.querySelector('#hand .card[data-card-id="7H"]');
      return {
        run: r.tableau[0].slots.map((sl) => sl.card.id).join(","),
        hand: r.hands[0].map((c) => c.id).join(","),
        dialog: root.hidden ? null : root.textContent,
        sevenSelected: !!sevenEl && sevenEl.classList.contains("selected"),
      };
    })()`);
    if (s.run !== "3H,4H,5H,6H") fail(`3H should be added, run is ${s.run}`);
    if (s.hand !== "7H") fail(`7H should stay in hand, hand is ${s.hand}`);
    if (!s.dialog || !/entire hand/i.test(s.dialog))
      fail(
        `the engine's reason should be shown, got ${JSON.stringify(s.dialog)}`,
      );
    if (!s.sevenSelected) fail("the refused 7H should stay selected");
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
  else
    console.log(
      "OK: multi-card add reports a refused card and keeps it selected",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
