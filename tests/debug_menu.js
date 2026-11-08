// The Debug panel (the AI's hand face-up, seed, log) stays available on the
// website but not in the store app: inside Capacitor's WebView
// (window.Capacitor.isNativePlatform() is true) the menu item is hidden and
// the panel stays off even if debug was switched on earlier.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8801;
const CDP_PORT = 9832;
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
    const load = async () => {
      await page.send("Page.navigate", {
        url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
      });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await q(`!!window.__cascadeTest?.getGame()`).catch(() => false))
          break;
      }
      return q(`({
        btnHidden: document.querySelector("#menuDebugBtn").hidden,
        panelHidden: document.querySelector("#debugPanel").hidden,
      })`);
    };

    // Website, debug switched on earlier: menu item and panel are there.
    const web = await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("cascade.debug", "1");`,
    });
    let s = await load();
    if (s.btnHidden) fail("website: the Debug menu item should be visible");
    if (s.panelHidden) fail("website: debug was on, the panel should show");
    await page.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: web.result.identifier,
    });

    // Store app (Capacitor WebView), same stored setting.
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("cascade.debug", "1");
               window.Capacitor = { isNativePlatform: () => true };`,
    });
    s = await load();
    if (!s.btnHidden) fail("app: the Debug menu item should be hidden");
    if (!s.panelHidden) fail("app: the Debug panel must stay off");
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
  else console.log("OK: Debug is available on the website, hidden in the app");
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
