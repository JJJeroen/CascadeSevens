// AI difficulty levels (novice < intermediate < hard): seeded AI-vs-AI
// tournaments plus a check that Hard never depends on the opponent's hand.
//
// Games are fully seeded and the AI has no randomness, so the results are
// deterministic: a failure means the AI or the rules changed the balance, not
// bad luck. Seats are swapped every other game so seat 0 / seat 1 effects
// cancel. Thresholds sit well below the measured win rates (see DESIGN.md
// §5.2) so a rules tweak doesn't trip them, but a broken level does.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";

const noop = { onStateChanged: () => {} };

function winRate(levelA, levelB, games) {
  let a = 0;
  let decided = 0;
  for (let g = 0; g < games; g++) {
    const rng = CascadeEngine.seededRng(g * 104729 + 7);
    const game = CascadeEngine.newGame("quick", rng);
    const seatA = g % 2;
    let rounds = 0;
    while (!game.gameOver && rounds++ < 40) {
      CascadeEngine.startRound(game, rng);
      let turns = 0;
      while (!game.round.ended && turns++ < 500) {
        const level = game.round.current === seatA ? levelA : levelB;
        CascadeAI.takeTurn(game, noop, level);
      }
      if (turns >= 500) {
        console.log(`STALL: ${levelA} vs ${levelB}, game ${g}`);
        process.exit(1);
      }
    }
    if (game.winner !== null) {
      decided++;
      if (game.winner === seatA) a++;
    }
  }
  return a / decided;
}

function expectAbove(levelA, levelB, games, floor) {
  const rate = winRate(levelA, levelB, games);
  const pct = (rate * 100).toFixed(1);
  if (rate <= floor) {
    console.log(
      `FAIL: ${levelA} beat ${levelB} only ${pct}% (need > ${floor * 100}%)`,
    );
    process.exit(1);
  }
  console.log(`${levelA} beats ${levelB}: ${pct}% over ${games} games`);
}

expectAbove("intermediate", "novice", 600, 0.65);
expectAbove("hard", "novice", 600, 0.65);
expectAbove("hard", "intermediate", 1200, 0.5);

// Hard may use the open row, the table, hand sizes and what it saw the
// opponent take -- never the opponent's hand itself. Swap the opponent's hand
// for the same number of cards from the closed pile: the choice must not move.
let states = 0;
for (let g = 0; g < 60; g++) {
  const rng = CascadeEngine.seededRng(g * 31 + 5);
  const game = CascadeEngine.newGame("quick", rng);
  CascadeEngine.startRound(game, rng);
  for (let t = 0; t < 40 && !game.round.ended; t++) {
    CascadeAI.takeTurn(game, noop, "intermediate");
    const r = game.round;
    if (r.ended || r.part === "turn0" || t < 4) continue;
    const opp = 1 - r.current;
    const before = CascadeAI.pickDiscard(game, "hard");
    const n = r.hands[opp].length;
    if (r.closedPile.length < n) continue;
    const real = r.hands[opp];
    const stand = r.closedPile.splice(0, n);
    r.hands[opp] = stand;
    const after = CascadeAI.pickDiscard(game, "hard");
    r.hands[opp] = real;
    r.closedPile.unshift(...stand);
    states++;
    if (before !== after) {
      console.log(
        `FAIL: Hard's discard depends on the opponent's hand (game ${g}, turn ${t})`,
      );
      process.exit(1);
    }
  }
}
if (states < 200) {
  console.log(`FAIL: only ${states} states checked, expected many more`);
  process.exit(1);
}
console.log(
  `OK: hard's discard ignored the opponent's hand in ${states} states.`,
);
