// Regression test: a delayed AI move left over from an earlier game must not
// fire in a later one. CascadeAI.takeTurn plays for whoever is current, so a
// stale timer used to play the HUMAN's side -- e.g. auto-declining the human's
// Turn 0 offer or melding their hand -- after a quick "New Game". That showed
// up as a ~25% flake in smoke_browser.js ("expected hand to shrink by 3...").
//
// Scenario (found by retrying until the dice line up): game A starts with the
// AI to move (so an AI timer is pending), then game B starts at once with the
// HUMAN to move at Turn 0. After the AI delay has passed, B must still be
// waiting on the human.

import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8793;
const CDP_PORT = 9824;
const MAX_ATTEMPTS = 80;
const AI_DELAY_MS = 900; // longer than the app's 500/600ms AI timers

async function main() {
  const browserBin = findBrowser();
  if (!browserBin) {
    console.log("SKIP: no Chromium/Chrome binary found on PATH");
    return;
  }
  const server = await startStaticServer(PORT);
  let page = null;
  let failed = false;
  try {
    page = await connect(browserBin, CDP_PORT);
    await page.send("Page.navigate", {
      url: `http://localhost:${PORT}/?test=1`,
    });
    await new Promise((r) => setTimeout(r, 700));

    let scenarios = 0;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const outcome = await page.evalJs(`(() => {
        const T = window.__cascadeTest;
        document.querySelector("#newGameBtn").click();
        const a = T.turn0Askee();
        document.querySelector("#newGameBtn").click();
        const b = T.turn0Askee();
        return { a, b };
      })()`);
      if (outcome.a === 1 && outcome.b === 0) {
        scenarios++;
        await new Promise((r) => setTimeout(r, AI_DELAY_MS));
        const still = await page.evalJs(`window.__cascadeTest.turn0Askee()`);
        if (still !== 0) {
          console.log(
            `FAIL: a stale AI timer from the previous game acted in the new one (Turn 0 offer to the human was auto-resolved; askee now ${still})`,
          );
          failed = true;
          break;
        }
        if (scenarios >= 3) break;
      } else {
        // let any AI timer from this attempt drain so attempts don't pile up
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    if (!failed && scenarios === 0) {
      console.log(
        `FAIL: never hit the AI-first-then-human-first scenario in ${MAX_ATTEMPTS} attempts`,
      );
      failed = true;
    }
    if (!failed)
      console.log(
        `OK: ${scenarios} stale-timer scenario(s) ran; the new game stayed with the human`,
      );
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
