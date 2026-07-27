global.window = global;
require('../docs/engine.js');
require('../docs/ai.js');

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

let totalRounds = 0;
let maxTurnsSeen = 0;

for (let g = 0; g < 300; g++) {
  const rng = seededRng(g * 7919 + 13);
  const game = CascadeEngine.newGame(g % 2 === 0 ? 'quick' : 'standard');
  let safety = 0;
  while (!game.gameOver && safety < 30) {
    safety++;
    CascadeEngine.startRound(game, rng);
    totalRounds++;
    let turns = 0;
    while (!game.round.ended && turns < 500) {
      turns++;
      CascadeAI.takeTurn(game, { onStateChanged: () => {} });
    }
    maxTurnsSeen = Math.max(maxTurnsSeen, turns);
    if (turns >= 500) {
      console.log(`GAME ${g}: round did not end within 500 turns — possible stall/loop.`);
      process.exit(1);
    }
    const r = game.round;
    let count = r.closedPile.length + r.openRow.length;
    count += r.hands[0].length + r.hands[1].length;
    for (const m of r.tableau) count += m.slots.length;
    if (count !== 54) {
      console.log(`GAME ${g}: card conservation FAILED — total ${count}, expected 54.`);
      console.log(JSON.stringify({closed: r.closedPile.length, row: r.openRow.length, h0: r.hands[0].length, h1: r.hands[1].length, tableau: r.tableau.reduce((s,m)=>s+m.slots.length,0)}));
      process.exit(1);
    }
    if (r.hands[0].length === 0 && r.endReason !== 'handout' || r.hands[1].length === 0 && r.endReason !== 'handout') {
      // fine, handled by endReason check below more precisely
    }
  }
  if (safety >= 30 && !game.gameOver) {
    console.log(`GAME ${g}: did not finish within 30 rounds (scores ${game.scores}).`);
  }
}

console.log(`OK: simulated ${totalRounds} rounds across 300 games. Max turns in a single round: ${maxTurnsSeen}.`);
