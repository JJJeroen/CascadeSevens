// Touch drags survive the browser's own touch scrolling. With real touch
// input (CDP touch emulation applies touch-action the way a phone does), a
// hold-then-slide used to be claimed by the browser as a pan, which cancels
// the pointer: sideways hand reorder and pulling your own card back from the
// table did nothing. Draggable cards now have touch-action: none.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8800;
const CDP_PORT = 9831;
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
      width: 360,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
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

    const setup = () =>
      q(`(() => {
        const c = (id, rank, suit) => ({ id, rank, suit });
        const r = window.__cascadeTest.getGame().round;
        r.part = 2; r.current = 0; r.ended = false; r.rearrange = null;
        r.comeOut = [true, true]; r.pendingObligations = []; r.rowObligationCardId = null;
        r.lastDraw = null; r.comeOutAttempt = null; r.undoStack = [];
        r.tableau = [{ id: "m1", type: "set", slots: ["S", "H", "D", "C"].map(
          (s) => ({ card: c("8" + s, "8", s), ownerId: 0, wildAs: null })) }];
        r.hands[0] = [c("9S","9","S"), c("9H","9","H"), c("3D","3","D"),
                      c("6D","6","D"), c("7D","7","D"), c("KC","K","C")];
        window.__cascadeTest.render();
        window.__cancels = 0;
        document.addEventListener("pointercancel", () => window.__cancels++);
      })()`);
    const centerOf = (sel, dx = 0) =>
      q(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        el.scrollIntoView({ block: "center" });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + ${dx}), y: Math.round(b.top + b.height / 2) };
      })()`);
    const touchDrag = async (from, to, holdMs = 300) => {
      await page.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [from],
      });
      await sleep(holdMs);
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await page.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: Math.round(from.x + ((to.x - from.x) * i) / steps),
              y: Math.round(from.y + ((to.y - from.y) * i) / steps),
            },
          ],
        });
        await sleep(16);
      }
      await page.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await sleep(250);
    };
    const handOrder = () =>
      q(
        `[...document.querySelectorAll("#hand .card")].map((e) => e.dataset.cardId)`,
      );

    // 1. Hand reorder: hold KC (the last card), slide left onto 9S's strip.
    await setup();
    const before = await handOrder();
    const kc = await centerOf('#hand .card[data-card-id="KC"]', 10);
    const s9 = await centerOf('#hand .card[data-card-id="9S"]', 4);
    await touchDrag(kc, { x: s9.x, y: kc.y });
    const after = await handOrder();
    if (after.indexOf("KC") >= before.indexOf("KC"))
      fail(
        `touch reorder: KC should move left (before ${before}, after ${after})`,
      );
    if (await q(`window.__cancels`))
      fail("touch reorder: the browser cancelled the pointer");

    // 2. Pull your own card back: hold 8C on the table, drag it to the hand.
    await setup();
    const c8 = await centerOf('#tableau .card[data-card-id="8C"]', 8);
    const hand = await centerOf("#hand", 40);
    await touchDrag(c8, hand);
    const pulled = await q(`(() => {
      const r = window.__cascadeTest.getGame().round;
      return { meld: r.tableau[0]?.slots.length, inHand: r.hands[0].some((c) => c.id === "8C") };
    })()`);
    if (pulled.meld !== 3 || !pulled.inHand)
      fail(
        `touch pull-back: 8C should move to the hand, got ${JSON.stringify(pulled)}`,
      );
    if (await q(`window.__cancels`))
      fail("touch pull-back: the browser cancelled the pointer");

    // 3. Control: dragging a hand card up onto a series (the vertical lift
    // that already worked) still reaches it.
    await setup();
    const k = await centerOf('#hand .card[data-card-id="9H"]', 10);
    await touchDrag(k, await centerOf('.meld[data-meld-id="m1"]', 30));
    // 9H doesn't fit a set of 8s: the drop is refused with a message, but the
    // drag itself must have reached the series (no pointercancel).
    if (await q(`window.__cancels`))
      fail("touch drag to a series: the browser cancelled the pointer");
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
      "OK: touch drags (hand reorder, pull-back, drag to a series) are not cancelled by scrolling",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
