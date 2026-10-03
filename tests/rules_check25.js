// The round log is shown to players, so it must use the app's terms (pile,
// cascade, table, series -- see the Figma naming) and not the old ones
// (closed pile, open row, tableau, meld). Plays whole AI-vs-AI games and
// checks every line.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";

function rngFor(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const OLD_TERMS = /\b(closed pile|open row|tableau|melds?|melded)\b|the row\b/i;
const seen = new Set();
const offenders = new Map();
let lines = 0;

for (let g = 0; g < 60; g++) {
  const rng = rngFor(g * 131 + 7);
  const game = CascadeEngine.newGame(g % 2 ? "quick" : "standard");
  for (let round = 0; round < 6 && !game.gameOver; round++) {
    CascadeEngine.startRound(game, rng);
    let turns = 0;
    while (!game.round.ended && turns++ < 500)
      CascadeAI.takeTurn(game, { onStateChanged() {} });
    for (const line of game.round.log) {
      lines++;
      const key = line.replace(/\d+/g, "#");
      if (OLD_TERMS.test(line) && !offenders.has(key)) offenders.set(key, line);
      seen.add(key);
    }
  }
}

if (lines < 500) {
  console.log(
    `FAIL: only ${lines} log lines scanned -- the simulation did not run`,
  );
  process.exit(1);
}
if (offenders.size > 0) {
  console.log("FAIL: log lines still use old terms:");
  for (const l of offenders.values()) console.log("  " + l);
  process.exit(1);
}
console.log(
  `OK: ${lines} log lines (${seen.size} distinct shapes) use the app's terms.`,
);
