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

// The heuristic levels are tested with Hard's Monte-Carlo search switched off
// (it makes Hard ~400x slower per move, too slow for thousands of games). The
// search has its own checks at the end of this file.
CascadeAI.aiSettings.search = false;

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
        const mover =
          game.round.part === "turn0"
            ? CascadeEngine.turn0CurrentAskee(game)
            : game.round.current;
        const level = mover === seatA ? levelA : levelB;
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

// The opponent model's memory must equal what was publicly visible: the cards
// that left the open row during the opponent's turns, minus those since laid
// on the table or put back on the row. Hard plays here (so its memory really
// updates). A memory filled from the opponent's actual hand would differ; the
// remembered cards must also really be in that hand.
let memChecks = 0;
let memNonEmpty = 0;
for (let g = 0; g < 80; g++) {
  const rng = CascadeEngine.seededRng(g * 17 + 3);
  const game = CascadeEngine.newGame("quick", rng);
  CascadeEngine.startRound(game, rng);
  const seat = g % 2;
  let prevRow = null;
  const expected = new Set();
  for (let t = 0; t < 120 && !game.round.ended; t++) {
    const r = game.round;
    const mover =
      r.part === "turn0" ? CascadeEngine.turn0CurrentAskee(game) : r.current;
    if (mover !== seat) {
      CascadeAI.takeTurn(game, noop, "intermediate");
      continue;
    }
    const rowNow = new Set(r.openRow.map((c) => c.id));
    const onTable = new Set(
      r.tableau.flatMap((m) => m.slots.map((sl) => sl.card.id)),
    );
    if (prevRow)
      for (const id of prevRow) if (!rowNow.has(id)) expected.add(id);
    for (const id of [...expected])
      if (onTable.has(id) || rowNow.has(id)) expected.delete(id);
    const oppHand = new Set(r.hands[1 - seat].map((c) => c.id));
    CascadeAI.takeTurn(game, noop, "hard");
    if (game.round.ended) break;
    const known = CascadeAI.knownOpponentCards(game, seat).sort();
    const want = [...expected].sort();
    memChecks++;
    if (known.length) memNonEmpty++;
    if (JSON.stringify(known) !== JSON.stringify(want)) {
      console.log(
        `FAIL: Hard's memory ${known} differs from the public record ${want} (game ${g}, turn ${t})`,
      );
      process.exit(1);
    }
    if (!known.every((id) => oppHand.has(id))) {
      console.log(
        `FAIL: Hard remembers a card the opponent does not hold (game ${g}, turn ${t})`,
      );
      process.exit(1);
    }
    prevRow = new Set(game.round.openRow.map((c) => c.id));
  }
}
if (memChecks < 400 || memNonEmpty < 100) {
  console.log(
    `FAIL: memory check too thin (${memChecks} checks, ${memNonEmpty} with known cards)`,
  );
  process.exit(1);
}
console.log(
  `OK: hard's memory matched the public record in ${memChecks} turns (${memNonEmpty} with known cards).`,
);

// --- Hard's search -------------------------------------------------------
// Switched back on: Hard now plays out simulated rest-of-round games. It must
// still use public information only: two copies of a position that differ only
// in the opponent's hidden hand (swapped with pile cards it will not draw this
// turn) must give identical results for Hard's whole turn.
CascadeAI.aiSettings.search = true;
let searchStates = 0;
for (let g = 0; g < 40 && searchStates < 30; g++) {
  const rng = CascadeEngine.seededRng(g * 53 + 9);
  const game = CascadeEngine.newGame("quick", rng);
  CascadeEngine.startRound(game, rng);
  for (let t = 0; t < 60 && !game.round.ended; t++) {
    CascadeAI.takeTurn(game, noop, "intermediate");
    const r = game.round;
    if (r.ended || r.part === "turn0" || t < 6 || t % 5 !== 0) continue;
    const opp = 1 - r.current;
    const n = r.hands[opp].length;
    if (r.closedPile.length < n + 12) continue;
    const a = structuredClone(game);
    const b = structuredClone(game);
    const rb = b.round;
    const real = rb.hands[opp];
    rb.hands[opp] = rb.closedPile.splice(0, n);
    rb.closedPile.unshift(...real);
    const mover = r.current;
    CascadeAI.takeTurn(a, noop, "hard");
    CascadeAI.takeTurn(b, noop, "hard");
    // the mover's own state after its turn (index mover, not the next player)
    const view = (x) => {
      const rr = x.round;
      return JSON.stringify({
        hand: rr.hands[mover].map((c) => c.id).sort(),
        row: rr.openRow.map((c) => c.id),
        table: rr.tableau.map((m) => m.slots.map((sl) => sl.card.id)),
      });
    };
    searchStates++;
    if (view(a) !== view(b)) {
      console.log(
        `FAIL: Hard's turn depends on the opponent's hand (game ${g}, turn ${t})`,
      );
      process.exit(1);
    }
  }
}
if (searchStates < 20) {
  console.log(`FAIL: only ${searchStates} search states checked`);
  process.exit(1);
}
console.log(
  `OK: hard's turn (with search) ignored the opponent's hand in ${searchStates} states.`,
);

// Smoke: whole games with the search on finish, no stalls.
for (let g = 0; g < 4; g++) {
  const rng = CascadeEngine.seededRng(g * 41 + 11);
  const game = CascadeEngine.newGame("quick", rng);
  let rounds = 0;
  while (!game.gameOver && rounds++ < 40) {
    CascadeEngine.startRound(game, rng);
    let turns = 0;
    while (!game.round.ended && turns++ < 500)
      CascadeAI.takeTurn(
        game,
        noop,
        game.round.current === g % 2 ? "hard" : "intermediate",
      );
    if (turns >= 500) {
      console.log(`STALL: hard (search) vs intermediate, game ${g}`);
      process.exit(1);
    }
  }
}
console.log("OK: hard with search played 4 full games without stalling.");

// Same check with Hard's memory live: replay a seeded game (Hard vs
// Intermediate, search off for the prefix so it is fast), and just before one
// Hard turn swap the opponent's hidden hand with pile cards it will not draw.
// Both replays are identical up to that point, so the memory of what the
// opponent took is real and the turn (with search on) must come out the same.
let liveStates = 0;
let withKnown = 0;
const playTo = (g, turnNo, swap) => {
  const rng = CascadeEngine.seededRng(g * 29 + 13);
  const game = CascadeEngine.newGame("quick", rng);
  CascadeEngine.startRound(game, rng);
  const seat = g % 2;
  for (let t = 0; t < 80 && !game.round.ended; t++) {
    const r = game.round;
    const mover =
      r.part === "turn0" ? CascadeEngine.turn0CurrentAskee(game) : r.current;
    const hard = mover === seat;
    if (hard && r.part !== "turn0" && t >= turnNo) {
      const opp = 1 - seat;
      const n = r.hands[opp].length;
      if (r.closedPile.length < n + 12) return null;
      if (swap) {
        const real = r.hands[opp];
        r.hands[opp] = r.closedPile.splice(0, n);
        r.closedPile.unshift(...real);
      }
      const known = CascadeAI.knownOpponentCards(game, seat).length;
      CascadeAI.aiSettings.search = true;
      CascadeAI.takeTurn(game, noop, "hard");
      CascadeAI.aiSettings.search = false;
      return {
        known,
        view: JSON.stringify({
          hand: game.round.hands[seat].map((c) => c.id).sort(),
          row: game.round.openRow.map((c) => c.id),
          table: game.round.tableau.map((m) => m.slots.map((sl) => sl.card.id)),
        }),
      };
    }
    CascadeAI.aiSettings.search = false;
    CascadeAI.takeTurn(game, noop, hard ? "hard" : "intermediate");
  }
  return null;
};
for (let g = 0; g < 60 && liveStates < 24; g++) {
  for (const turnNo of [8, 14, 20]) {
    const a = playTo(g, turnNo, false);
    const b = playTo(g, turnNo, true);
    if (!a || !b) continue;
    liveStates++;
    if (a.known > 0) withKnown++;
    if (a.view !== b.view) {
      console.log(
        `FAIL: Hard's turn depends on the opponent's hand with live memory (game ${g}, turn ${turnNo})`,
      );
      process.exit(1);
    }
  }
}
CascadeAI.aiSettings.search = true;
if (liveStates < 12 || withKnown < 3) {
  console.log(
    `FAIL: live-memory check too thin (${liveStates} states, ${withKnown} with remembered cards)`,
  );
  process.exit(1);
}
console.log(
  `OK: hard's turn ignored the opponent's hand with live memory in ${liveStates} states (${withKnown} with remembered cards).`,
);
