// A tap held a little longer than the drag hold time (180 ms) is still a tap:
// it selects a hand card, and tapping it again deselects it. Before the fix
// the hold armed a drag, the release was treated as a drop on nothing, and
// the tap was lost. Real mouse and touch input in headless Chromium.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8798;
const CDP_PORT = 9829;
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
      r.lastDraw = null; r.comeOutAttempt = null; r.undoStack = []; r.tableau = [];
      r.hands[0] = [c("9S","9","S"), c("9H","9","H"), c("9D","9","D"),
                    c("6D","6","D"), c("7D","7","D"), c("KC","K","C")];
      window.__cascadeTest.render();
    })()`);

    // The visible strip of a card (left part; cards overlap to the right).
    const pointOf = (id) =>
      q(`(() => {
        const el = document.querySelector('#hand .card[data-card-id="${id}"]');
        el.scrollIntoView({ block: "center" });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + 10), y: Math.round(b.top + b.height / 2) };
      })()`);
    const isSelected = (id) =>
      q(
        `document.querySelector('#hand .card[data-card-id="${id}"]').classList.contains("selected")`,
      );
    const mouseTap = async (id, holdMs) => {
      const { x, y } = await pointOf(id);
      const base = { x, y, button: "left", clickCount: 1 };
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });
      await page.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...base,
      });
      await sleep(holdMs);
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...base,
      });
      await sleep(150);
    };
    const touchTap = async (id, holdMs) => {
      const { x, y } = await pointOf(id);
      await page.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await sleep(holdMs);
      await page.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await sleep(250);
    };

    // A quick tap still works (control).
    await mouseTap("9S", 60);
    if (!(await isSelected("9S"))) fail("a quick mouse tap should select 9S");
    await mouseTap("9S", 60);
    if (await isSelected("9S")) fail("a second quick tap should deselect 9S");

    // Slow mouse taps: held past the 180 ms hold time, no movement.
    for (const hold of [250, 400]) {
      await mouseTap("9H", hold);
      if (!(await isSelected("9H")))
        fail(`a ${hold} ms mouse tap should select 9H`);
      await mouseTap("9H", hold);
      if (await isSelected("9H"))
        fail(`a second ${hold} ms mouse tap should deselect 9H`);
    }

    // Slow touch taps.
    await page.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    for (const hold of [250, 400]) {
      await touchTap("6D", hold);
      if (!(await isSelected("6D")))
        fail(`a ${hold} ms touch tap should select 6D`);
      await touchTap("6D", hold);
      if (await isSelected("6D"))
        fail(`a second ${hold} ms touch tap should deselect 6D`);
    }

    // Exactly one toggle per tap: no double selection from a native click
    // arriving after the tap action already ran.
    const selectedCount = await q(
      `document.querySelectorAll("#hand .card.selected").length`,
    );
    if (selectedCount !== 0)
      fail(`no card should be selected at the end, got ${selectedCount}`);
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
      "OK: slow taps (250/400 ms, mouse and touch) select and deselect hand cards",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
