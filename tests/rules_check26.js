// §2.4 (2026-10-03): a player who hasn't come out never leaves under-40 melds
// on the table at the end of a turn. Plays AI-vs-AI games and checks, after
// every single turn, that the player who just moved either has come out or has
// nothing laid -- the AI must have taken any short melds back.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";

function rngFor(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

let turnsChecked = 0;
let shortTakeBacks = 0;

for (let g = 0; g < 300; g++) {
  const rng = rngFor(g * 17 + 3);
  const game = CascadeEngine.newGame(g % 2 ? "quick" : "standard");
  for (let round = 0; round < 5 && !game.gameOver; round++) {
    CascadeEngine.startRound(game, rng);
    let guard = 0;
    while (!game.round.ended && guard++ < 500) {
      const r = game.round;
      const mover = r.part === "turn0" ? null : r.current;
      const logBefore = r.log.length;
      CascadeAI.takeTurn(game, { onStateChanged() {} });
      if (mover === null || r.ended) continue;
      turnsChecked++;
      if (r.log.slice(logBefore).some((l) => /took \d+ card\(s\) back/.test(l)))
        shortTakeBacks++;
      if (!r.comeOut[mover]) {
        const mine = r.tableau
          .flatMap((m) => m.slots)
          .filter((s) => s.ownerId === mover);
        if (mine.length > 0 || r.comeOutAccum[mover] !== 0) {
          console.log(
            `FAIL: game ${g}: player ${mover + 1} ended a turn without coming out but left ${mine.length} card(s) on the table (accum ${r.comeOutAccum[mover]})`,
          );
          process.exit(1);
        }
      }
    }
  }
}

if (turnsChecked < 2000 || shortTakeBacks === 0) {
  console.log(
    `FAIL: not enough coverage (${turnsChecked} turns, ${shortTakeBacks} take-backs) -- the simulation may not exercise the rule`,
  );
  process.exit(1);
}
console.log(
  `OK: ${turnsChecked} AI turns checked; ${shortTakeBacks} of them took short melds back; none ended a turn with under-40 melds on the table.`,
);
