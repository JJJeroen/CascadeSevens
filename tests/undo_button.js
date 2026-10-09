// The undo button (the arrow by the hand) takes back your last move this turn:
// lay 9-9-9, press undo, lay 6-7-8-9 instead. Real clicks in headless Chromium.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8797;
const CDP_PORT = 9828;
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

    // You have come out and drawn; your hand holds 9S 9H 9D 6D 7D 8D KC.
    await q(`(() => {
      const c = (id, rank, suit) => ({ id, rank, suit });
      const r = window.__cascadeTest.getGame().round;
      r.part = 2; r.current = 0; r.ended = false; r.rearrange = null;
      r.comeOut = [true, true]; r.pendingObligations = []; r.rowObligationCardId = null;
      r.lastDraw = null; r.comeOutAttempt = null; r.undoStack = []; r.tableau = [];
      r.hands[0] = [c("9S","9","S"), c("9H","9","H"), c("9D","9","D"),
                    c("6D","6","D"), c("7D","7","D"), c("8D","8","D"), c("KC","K","C")];
      window.__cascadeTest.render();
    })()`);
    const undoDisabled = () =>
      q(`document.querySelector("#undoDrawBtn").disabled`);
    const tableCards = () =>
      q(
        `[...document.querySelectorAll("#tableau .meld")].map(m => m.querySelectorAll(".card").length)`,
      );
    const handCount = () =>
      q(`document.querySelectorAll("#hand .card").length`);
    const tap = (sel) =>
      q(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const pick = async (...ids) => {
      for (const id of ids) await tap(`#hand .card[data-card-id="${id}"]`);
    };

    if (!(await undoDisabled()))
      fail("undo should be disabled before anything is done");

    // Lay 9-9-9.
    await pick("9S", "9H", "9D");
    await tap("#layMeldBtn");
    if (JSON.stringify(await tableCards()) !== "[3]")
      return fail(
        `9-9-9 should be on the table, got ${JSON.stringify(await tableCards())}`,
      );
    if (await undoDisabled())
      fail("undo should be enabled after laying a series");

    // Undo: the table is empty again and all 7 cards are back.
    await tap("#undoDrawBtn");
    if (JSON.stringify(await tableCards()) !== "[]")
      fail(
        `undo should clear the table, got ${JSON.stringify(await tableCards())}`,
      );
    if ((await handCount()) !== 7)
      fail(`the hand should have 7 cards again, got ${await handCount()}`);
    if (!(await undoDisabled()))
      fail("undo should be disabled again with nothing left to undo");

    // The mistake is fixed: lay 6-7-8-9 instead.
    await pick("6D", "7D", "8D", "9D");
    await tap("#layMeldBtn");
    if (JSON.stringify(await tableCards()) !== "[4]")
      fail(
        `6-7-8-9 should be on the table, got ${JSON.stringify(await tableCards())}`,
      );
    if ((await handCount()) !== 3)
      fail(`the hand should have 3 cards, got ${await handCount()}`);

    // Undo again: the run is taken back as well.
    await tap("#undoDrawBtn");
    if (JSON.stringify(await tableCards()) !== "[]")
      fail("undoing the run should clear the table");
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
  else console.log("OK: undo button: lay 9-9-9, undo, lay 6-7-8-9 instead");
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
