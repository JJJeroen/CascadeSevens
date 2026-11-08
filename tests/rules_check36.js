// Hard's discard search stops at its wall-clock budget (aiSettings.searchMs),
// so a slow phone can't freeze on the AI's move. Out of time before even one
// sample is finished, it plays its heuristic first choice -- the same card the
// search-off heuristic picks.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";
const E = CascadeEngine;
const S = CascadeAI.aiSettings;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL: ${name} -> ${e.message}`);
  }
}

// Player 0 in Part 2 after a pile draw, from a seeded deal.
function position(seed) {
  const game = E.newGame("standard", E.seededRng(seed));
  E.startRound(game, E.seededRng(seed + 1));
  E.turn0Decline(game);
  E.turn0Decline(game);
  const r = game.round;
  r.current = 0;
  r.part = 1;
  E.drawFromClosedPile(game);
  return game;
}
const saved = { ...S };

check("no time at all: the search returns the heuristic first choice", () => {
  for (let seed = 1; seed <= 25; seed++) {
    S.search = false;
    const heuristic = CascadeAI.pickDiscard(position(seed), "hard");
    S.search = true;
    S.searchMs = 0;
    const t0 = performance.now();
    const searched = CascadeAI.pickDiscard(position(seed), "hard");
    const ms = performance.now() - t0;
    if (searched !== heuristic)
      throw new Error(`seed ${seed}: ${searched} vs heuristic ${heuristic}`);
    if (ms > 100) throw new Error(`seed ${seed}: took ${ms.toFixed(0)} ms`);
  }
});

check("a short budget is respected (one playout of slack at most)", () => {
  S.search = true;
  S.searchMs = 30;
  let worst = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const game = position(seed);
    const t0 = performance.now();
    CascadeAI.pickDiscard(game, "hard");
    worst = Math.max(worst, performance.now() - t0);
  }
  // 30 ms budget + one playout (a few ms on a desktop) + slow-CI margin.
  if (worst > 250)
    throw new Error(`worst decision took ${worst.toFixed(0)} ms`);
});

check("the result is still a card in hand", () => {
  S.search = true;
  S.searchMs = 400;
  const game = position(7);
  const id = CascadeAI.pickDiscard(game, "hard");
  if (!game.round.hands[0].some((c) => c.id === id))
    throw new Error(`${id} is not in the hand`);
});

Object.assign(S, saved);
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nOK: Hard's search keeps to its time budget");
}
