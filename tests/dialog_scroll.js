// A popup never runs off the screen: Help on a small phone used to start
// above the top edge (title and close button unreachable) because the box had
// no max-height. Now it is capped at the screen height and scrolls, and a
// short popup can still be dragged out of the way.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8799;
const CDP_PORT = 9830;
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
    const q = (js) => page.evalJs(js);
    const open = async (width, height) => {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.send("Page.navigate", {
        url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
      });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await q(`!!window.__cascadeTest?.getGame()`).catch(() => false))
          break;
      }
      await q(`window.__cascadeTest.disableAI()`);
    };
    const box = () =>
      q(`(() => {
        const b = document.querySelector("#dialogBox");
        const r = b.getBoundingClientRect();
        const t = b.querySelector(".dialog-title").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                 titleTop: t.top, scrolls: b.classList.contains("scrolls"),
                 canScroll: b.scrollHeight > b.clientHeight + 1,
                 vw: innerWidth, vh: innerHeight };
      })()`);
    const openHelp = async () => {
      await q(`document.querySelector("#menuBtn").click()`);
      await sleep(100);
      await q(`document.querySelector("#menuHelpBtn").click()`);
      await sleep(200);
    };

    for (const [w, h] of [
      [360, 640],
      [740, 360],
      [412, 915],
    ]) {
      await open(w, h);
      await openHelp();
      const b = await box();
      if (b.top < 0 || b.bottom > b.vh + 0.5)
        fail(`${w}x${h}: Help runs off the screen (${b.top}..${b.bottom})`);
      if (b.left < 0 || b.right > b.vw + 0.5)
        fail(
          `${w}x${h}: Help is wider than the screen (${b.left}..${b.right})`,
        );
      if (b.titleTop < b.top)
        fail(`${w}x${h}: the Help title should be visible when it opens`);
      if (b.canScroll !== b.scrolls)
        fail(`${w}x${h}: .scrolls should match whether the box overflows`);
      if (b.canScroll) {
        // The OK button at the end can be scrolled into view inside the box.
        const okVisible = await q(`(() => {
          const b = document.querySelector("#dialogBox");
          b.scrollTop = b.scrollHeight;
          const ok = [...b.querySelectorAll(".modal-actions button")].pop();
          const r = ok.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        })()`);
        if (!okVisible) fail(`${w}x${h}: OK should be reachable by scrolling`);
      }
    }

    // On the small phone Help must actually be the scrolling kind.
    await open(360, 640);
    await openHelp();
    if (!(await box()).scrolls)
      fail("360x640: Help should scroll (it is taller than the screen)");
    await q(
      `document.querySelector("#dialogBox .modal-actions button").click()`,
    );

    // A short popup still drags: open the Goal dialog and move it down.
    await q(`document.querySelector("#menuBtn").click()`);
    await sleep(100);
    await q(`document.querySelector("#menuGoalBtn").click()`);
    await sleep(200);
    const before = await box();
    if (before.scrolls) fail("the Goal popup should not need to scroll");
    const x = Math.round((before.left + before.right) / 2);
    const y = Math.round(before.top + 6);
    for (const [type, yy] of [
      ["mousePressed", y],
      ["mouseMoved", y + 40],
      ["mouseMoved", y + 80],
      ["mouseReleased", y + 80],
    ])
      await page.send("Input.dispatchMouseEvent", {
        type,
        x,
        y: yy,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
      });
    await sleep(100);
    const after = await box();
    if (after.top - before.top < 40)
      fail(`a short popup should drag (moved ${after.top - before.top}px)`);
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
      "OK: popups fit the screen (Help scrolls on small screens); short popups still drag",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
