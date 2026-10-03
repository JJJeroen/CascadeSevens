// Startup splash + version: a normal start shows the splash (image, title and
// the version "0.<last merged PR>") for about 2 seconds and then it is gone;
// the menu shows the same version; ?test=1 skips the splash so the other
// browser tests aren't covered by it.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8794;
const CDP_PORT = 9825;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => {
  console.log(`FAIL: ${m}`);
  failed = true;
};

async function load(page, query) {
  await page.send("Page.navigate", {
    url: `http://localhost:${PORT}/${query}`,
  });
  await sleep(300);
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
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
    });

    await load(page, "?t=" + Date.now());
    // the version is fetched asynchronously: wait for it (the splash itself
    // is up for 2 seconds, so there is plenty of time)
    for (let i = 0; i < 15; i++) {
      if (
        await page.evalJs(
          `!!document.querySelector("#splashVersion")?.textContent`,
        )
      )
        break;
      await sleep(100);
    }
    const s = await page.evalJs(`(() => {
      const sp = document.querySelector("#splash");
      if (!sp) return null;
      const img = sp.querySelector("img");
      return { opacity: getComputedStyle(sp).opacity,
               covers: sp.getBoundingClientRect().width >= window.innerWidth,
               imgLoaded: img.complete && img.naturalWidth > 0,
               title: sp.querySelector(".splash-title").textContent,
               version: document.querySelector("#splashVersion").textContent };
    })()`);
    if (!s) return fail("the splash should be showing right after startup");
    if (s.opacity !== "1" || !s.covers)
      fail(`splash should fully cover the screen: ${JSON.stringify(s)}`);
    if (!s.imgLoaded) fail("splash image did not load (docs/splash.png)");
    if (s.title !== "Cascade Break") fail(`unexpected title ${s.title}`);
    if (!/^(0\.\d+|dev build)$/.test(s.version))
      fail(
        `version should look like 0.54 (or "dev build"), got ${JSON.stringify(s.version)}`,
      );

    await sleep(3000);
    if (await page.evalJs(`!!document.querySelector("#splash")`))
      fail("the splash should be gone after ~2.5 seconds");

    await page.evalJs(`document.querySelector("#menuBtn").click()`);
    const menu = await page.evalJs(
      `document.querySelector("#menuVersion").textContent`,
    );
    if (menu !== `Version ${s.version}`)
      fail(
        `menu should show "Version ${s.version}", got ${JSON.stringify(menu)}`,
      );

    await load(page, "?test=1&t=" + Date.now());
    if (await page.evalJs(`!!document.querySelector("#splash")`))
      fail("?test=1 should skip the splash");
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
      "OK: splash shows for ~2s with the version; menu shows it too; ?test skips it",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
