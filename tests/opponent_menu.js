// Menu > Opponent: shows the current level, lists the three levels, picking one
// starts a new game, updates the menu label and is remembered after a reload.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8795;
const CDP_PORT = 9826;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => {
  console.log(`FAIL: ${m}`);
  failed = true;
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
    const load = async () => {
      await page.send("Page.navigate", {
        url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
      });
      await sleep(400);
    };
    const label = () =>
      page.evalJs(`document.querySelector("#menuLevelBtn").textContent`);
    const openOpponent = async () => {
      await page.evalJs(`document.querySelector("#menuBtn").click()`);
      await page.evalJs(`document.querySelector("#menuLevelBtn").click()`);
    };

    await load();
    await page.evalJs(`localStorage.removeItem("cascade.level")`);
    await load();
    await page.evalJs(`document.querySelector("#menuBtn").click()`);
    if ((await label()) !== "Opponent: Intermediate")
      fail(`default should be Intermediate, got ${await label()}`);

    await openOpponent();
    const dlg = await page.evalJs(`(() => {
      const r = document.querySelector("#dialogRoot");
      return { open: !r.hidden, title: r.querySelector(".dialog-title")?.textContent,
               buttons: [...r.querySelectorAll("button:not(.x-btn)")].map(b => b.textContent) };
    })()`);
    if (!dlg.open || dlg.title !== "Opponent")
      fail(`Opponent dialog did not open: ${JSON.stringify(dlg)}`);
    if (JSON.stringify(dlg.buttons) !== '["Novice","Intermediate","Hard"]')
      fail(`unexpected level buttons ${JSON.stringify(dlg.buttons)}`);

    // Picking Hard starts a new game (round 1 again) and relabels the menu.
    await page.evalJs(
      `[...document.querySelectorAll("#dialogRoot button")].find(b => b.textContent === "Hard").click()`,
    );
    await sleep(200);
    await page.evalJs(`document.querySelector("#menuBtn").click()`);
    if ((await label()) !== "Opponent: Hard")
      fail(`label should read Opponent: Hard, got ${await label()}`);
    const stored = await page.evalJs(`localStorage.getItem("cascade.level")`);
    if (stored !== "hard") fail(`level not stored, got ${stored}`);
    const round = await page.evalJs(
      `window.__cascadeTest.getGame().roundNumber`,
    );
    if (round !== 1)
      fail(`picking a level should start a new game, round=${round}`);

    // Remembered after a reload; a junk stored value falls back to default.
    await load();
    await page.evalJs(`document.querySelector("#menuBtn").click()`);
    if ((await label()) !== "Opponent: Hard")
      fail(`level not remembered after reload: ${await label()}`);
    await page.evalJs(`localStorage.setItem("cascade.level", "bogus")`);
    await load();
    await page.evalJs(`document.querySelector("#menuBtn").click()`);
    if ((await label()) !== "Opponent: Intermediate")
      fail(`junk stored level should fall back, got ${await label()}`);
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
      "OK: Opponent menu lists 3 levels, restarts the game, and is remembered",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
