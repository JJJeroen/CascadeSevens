// Story #16: shareable deal seed. CascadeEngine.seededRng(seed) must be a
// pure, deterministic RNG source -- the same seed fed through newGame() +
// startRound() has to reproduce an identical shuffle, starter card, and
// nextRoundStarter coin-flip every time, so a disputed game can be replayed
// exactly from a seed alone rather than from screenshots/memory. AI play is
// already fully deterministic (no Math.random anywhere in ai.js), so a
// reproduced deal + the same sequence of actions reproduces the whole game.
import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;

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

function dealFromSeed(seed) {
  const rng = E.seededRng(seed);
  const game = E.newGame("standard", rng);
  E.startRound(game, rng);
  return game;
}

function cardIds(cards) {
  return cards.map((c) => c.id).join(",");
}

check("the same seed reproduces an identical deal end-to-end", () => {
  const g1 = dealFromSeed(424242);
  const g2 = dealFromSeed(424242);
  if (g1.nextRoundStarter !== g2.nextRoundStarter)
    throw new Error("round-1 starter coin flip differed for the same seed");
  if (g1.round.starter !== g2.round.starter)
    throw new Error("round starter differed for the same seed");
  if (cardIds(g1.round.hands[0]) !== cardIds(g2.round.hands[0]))
    throw new Error("P1 hand differed for the same seed");
  if (cardIds(g1.round.hands[1]) !== cardIds(g2.round.hands[1]))
    throw new Error("P2 hand differed for the same seed");
  if (cardIds(g1.round.openRow) !== cardIds(g2.round.openRow))
    throw new Error("starter card differed for the same seed");
  if (cardIds(g1.round.closedPile) !== cardIds(g2.round.closedPile))
    throw new Error("closed pile order differed for the same seed");
});

check("different seeds produce different deals (sanity)", () => {
  const g1 = dealFromSeed(1);
  const g2 = dealFromSeed(2);
  if (cardIds(g1.round.hands[0]) === cardIds(g2.round.hands[0]))
    throw new Error(
      "two different seeds produced the same P1 hand -- seededRng may not be seed-sensitive",
    );
});

check(
  "a reproduced deal replays identically through a real action sequence, not just the initial deal",
  () => {
    const g1 = dealFromSeed(99999);
    const g2 = dealFromSeed(99999);
    for (const g of [g1, g2]) {
      E.turn0Decline(g);
      E.turn0Decline(g);
      if (!E.canDrawFromClosedPile(g))
        throw new Error(
          "test setup: expected closed-pile draw to be available",
        );
      E.drawFromClosedPile(g); // a closed-pile draw ends Part 1 immediately, no separate finishDrawing() needed
      const discardCard = g.round.hands[g.round.current][0];
      E.discard(g, discardCard.id);
    }
    if (JSON.stringify(g1.round.log) !== JSON.stringify(g2.round.log))
      throw new Error(
        "identical seed + identical action sequence produced different logs -- replay is not actually deterministic",
      );
    if (cardIds(g1.round.hands[0]) !== cardIds(g2.round.hands[0]))
      throw new Error(
        "identical seed + identical action sequence produced different resulting hands",
      );
  },
);

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
