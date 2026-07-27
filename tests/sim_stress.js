global.window = global;
require('../docs/engine.js');
require('../docs/ai.js');
function seededRng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
let totalRounds = 0;
for (let g = 0; g < 1000; g++) {
  const rng = seededRng(g * 104729 + 99991);
  const game = CascadeEngine.newGame(g % 2 === 0 ? 'quick' : 'standard');
  let safety = 0;
  while (!game.gameOver && safety < 30) {
    safety++;
    CascadeEngine.startRound(game, rng);
    totalRounds++;
    let turns = 0;
    while (!game.round.ended && turns < 500) { turns++; CascadeAI.takeTurn(game, { onStateChanged: () => {} }); }
    if (turns >= 500) { console.log(`GAME ${g}: STALL`); process.exit(1); }
    const r = game.round;
    let count = r.closedPile.length + r.openRow.length + r.hands[0].length + r.hands[1].length;
    for (const m of r.tableau) count += m.slots.length;
    if (count !== 54) { console.log(`GAME ${g}: card conservation FAILED (${count})`); process.exit(1); }
  }
}
console.log(`OK: ${totalRounds} rounds across 1000 games, no stalls, card conservation held.`);
