// The line saying what the AI just did ("AI drew from the pile, laid
// 10♣ J♣ Q♣ K♣ and discarded Q♠."), built by comparing the table before and
// after the AI's turn. Exact sentences for scripted turns, then one real AI
// turn through the same code path the timer uses.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8803;
const CDP_PORT = 9834;
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
    await page.send("Page.navigate", {
      url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
    });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await q(`!!window.__cascadeTest?.getGame()`).catch(() => false))
        break;
    }
    await q(`window.__cascadeTest.disableAI()`);
    // The AI (player 2) to move in Part 1, with a known hand, cascade and table.
    const setup = (hand, row, comeOut) =>
      q(`(() => {
        const T = window.__cascadeTest, g = T.getGame(), r = g.round;
        const c = (id) => id.startsWith("JOKER")
          ? { id, rank: "JOKER", suit: null }
          : { id, rank: id.slice(0, -1), suit: id.slice(-1) };
        const used = new Set([...${JSON.stringify(hand)}, ...${JSON.stringify(row)}, "3H", "4H", "5H", "6H"]);
        r.part = 1; r.current = 1; r.ended = false; r.rearrange = null;
        r.comeOut = [true, ${comeOut}]; r.comeOutAccum = [0, 0]; r.comeOutAttempt = null;
        r.pendingObligations = []; r.rowObligationCardId = null; r.owedThisTurn = [];
        r.lastDraw = null; r.undoStack = []; r.turnStart = null; r.rowDrawsThisPart1 = 0;
        r.hands[1] = ${JSON.stringify(hand)}.map(c);
        r.openRow = ${JSON.stringify(row)}.map(c);
        r.tableau = [{ id: "you1", type: "run", slots: ["3H", "4H", "5H", "6H"].map(
          (id) => ({ card: c(id), ownerId: 0, wildAs: null })) }];
        r.closedPile = T.engine.buildDeck().filter((x) => !used.has(x.id) && !r.hands[0].some((h) => h.id === x.id));
        // a known pile top
        r.closedPile = r.closedPile.filter((x) => x.id !== "2C").concat([c("2C")]);
        window.__before = T.snapTable(g);
      })()`);
    const describe = () =>
      q(
        `window.__cascadeTest.describeAiMove(window.__before, window.__cascadeTest.snapTable(window.__cascadeTest.getGame()))`,
      );
    const E = (call) => q(`window.__cascadeTest.engine.${call}`);
    const g = `window.__cascadeTest.getGame()`;
    const sel = (...ids) => JSON.stringify(ids.map((cardId) => ({ cardId })));

    // 1. Pile draw, a new series, discard.
    await setup(["10C", "JC", "QC", "KC", "5D", "QS"], ["8D"], false);
    await E(`drawFromClosedPile(${g})`);
    await E(`layNewMeld(${g}, ${sel("10C", "JC", "QC", "KC")})`);
    await E(`discard(${g}, "QS")`);
    let s = await describe();
    if (s !== "AI drew from the pile, laid 10♣ J♣ Q♣ K♣ and discarded Q♠.")
      fail(`pile turn: ${JSON.stringify(s)}`);

    // 2. A two-card cascade take, a set, a card added to your run, discard.
    await setup(["9D", "7H", "KS", "2D"], ["8D", "9S", "9H"], true);
    await E(`drawFromOpenRow(${g}, "9S")`);
    await E(`layNewMeld(${g}, ${sel("9S", "9H", "9D")})`);
    await E(`addToMeld(${g}, "you1", "7H")`);
    await E(`discard(${g}, "KS")`);
    s = await describe();
    if (
      s !==
      "AI took 2 cards from the cascade (9♠ and up), laid 9♠ 9♥ 9♦, added 7♥ and discarded K♠."
    )
      fail(`cascade turn: ${JSON.stringify(s)}`);

    // 3. A real AI turn through the app's own path fills the line.
    await setup(["10C", "JC", "QC", "KC", "5D", "QS"], ["8D"], false);
    await q(`window.__cascadeTest.aiTurn()`);
    const line = await q(`(() => {
      const el = document.querySelector("#aiMoveLine");
      return el.hidden ? null : el.textContent;
    })()`);
    if (!line || !/^AI .* discarded .+\.$/.test(line))
      fail(
        `after a real AI turn the line should show, got ${JSON.stringify(line)}`,
      );
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
  else console.log("OK: the AI's last move is described in one line");
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
