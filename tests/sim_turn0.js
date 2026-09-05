// High-tier: Turn 0 acceptance under real randomized play. docs/ai.js always
// declines the Turn 0 exchange (kept simple by design), so the existing
// AI-vs-AI simulations (sim2.js/sim_stress.js) never exercise ANY of the
// three accept paths -- only unit tests do, with hand-picked scenarios. This
// project's own history shows bugs in exactly this kind of blind spot (a
// mechanic only unit-tested, never fuzzed) need hundreds to thousands of
// random games to surface once something starts actually exercising them.
//
// This does not change docs/ai.js. It's a standalone harness that randomly
// accepts or declines at each Turn 0 decision point, then hands the rest of
// the turn to the real AI as normal -- so every subsequent turn plays out
// exactly as it would in production, just starting from a Turn-0-resolved
// state the real AI itself never produces on its own.
global.window = global;
require('../docs/engine.js');
require('../docs/ai.js');
const E = CascadeEngine;

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function resolveTurn0Randomly(game, rng) {
  const r = game.round;
  const askee = E.turn0CurrentAskee(game);
  if (askee === null) { E.turn0Decline(game); return; } // shouldn't happen, but never hang
  if (rng() < 0.5) {
    const hand = r.hands[askee];
    const replacement = hand[Math.floor(rng() * hand.length)];
    E.turn0Accept(game, replacement.id);
  } else {
    E.turn0Decline(game);
  }
}

let totalRounds = 0;
let turn0Accepts = 0;
const GAMES = 1000;

for (let g = 0; g < GAMES; g++) {
  const rng = seededRng(g * 104729 + 12345);
  const game = E.newGame(g % 2 === 0 ? 'quick' : 'standard', rng);
  let safety = 0;
  while (!game.gameOver && safety < 30) {
    safety++;
    E.startRound(game, rng);
    totalRounds++;
    let turns = 0;
    while (!game.round.ended && turns < 500) {
      turns++;
      if (game.round.part === 'turn0') {
        const before = game.round.turn0.lastAcceptor;
        resolveTurn0Randomly(game, rng);
        if (game.round.turn0.lastAcceptor !== before && game.round.turn0.lastAcceptor !== null) turn0Accepts++;
      } else {
        CascadeAI.takeTurn(game, { onStateChanged: () => {} });
      }
    }
    if (turns >= 500) { console.log(`GAME ${g}: STALL`); process.exit(1); }
    const r = game.round;
    let count = r.closedPile.length + r.openRow.length + r.hands[0].length + r.hands[1].length;
    for (const m of r.tableau) count += m.slots.length;
    if (count !== 54) { console.log(`GAME ${g}: card conservation FAILED (${count})`); process.exit(1); }
  }
}

if (turn0Accepts === 0) {
  console.log('FAIL: Turn 0 was never actually accepted across 1000 games -- the harness itself is broken, not just unlucky.');
  process.exit(1);
}
console.log(`OK: ${totalRounds} rounds across ${GAMES} games, ${turn0Accepts} Turn-0 acceptances exercised, no stalls, card conservation held.`);
