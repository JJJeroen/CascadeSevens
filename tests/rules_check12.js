global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

check('newGame: starter is random (both outcomes reachable)', () => {
  const gameLow = E.newGame('standard', () => 0.1);
  const gameHigh = E.newGame('standard', () => 0.9);
  if (gameLow.nextRoundStarter !== 0) throw new Error('rng<0.5 should give starter 0');
  if (gameHigh.nextRoundStarter !== 1) throw new Error('rng>=0.5 should give starter 1');
});

check('startRound: round 1 uses the game-level starter, current begins there even before Turn 0 resolves', () => {
  const game = E.newGame('standard', () => 0.9); // starter = 1
  E.startRound(game, () => 0.5);
  if (game.round.starter !== 1) throw new Error('round.starter should match nextRoundStarter, got ' + game.round.starter);
  if (E.turn0CurrentAskee(game) !== 1) throw new Error('Turn 0 should offer the starter (player 1) first, got ' + E.turn0CurrentAskee(game));
});

check('startRound: starter alternates round to round', () => {
  const game = E.newGame('standard', () => 0.1); // round 1 starter = 0
  E.startRound(game, () => 0.5);
  if (game.round.starter !== 0) throw new Error('round 1 starter should be 0');
  // finish round 1 quickly via a forced discard-to-empty-hand
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.part = 2;
  game.round.hands[game.round.current] = [{id:'2C',rank:'2',suit:'C'}];
  E.discard(game, '2C');
  if (!game.round.ended) throw new Error('test setup: round should have ended');

  E.startRound(game, () => 0.5); // round 2
  if (game.round.starter !== 1) throw new Error('round 2 starter should alternate to 1, got ' + game.round.starter);

  E.turn0Decline(game); E.turn0Decline(game);
  game.round.part = 2;
  game.round.hands[game.round.current] = [{id:'3C',rank:'3',suit:'C'}];
  E.discard(game, '3C');
  E.startRound(game, () => 0.5); // round 3
  if (game.round.starter !== 0) throw new Error('round 3 starter should alternate back to 0, got ' + game.round.starter);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
