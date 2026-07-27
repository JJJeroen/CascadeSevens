global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit||''}`, rank, suit: suit||null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

check('liveScore does not double-count after the round has ended', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.comeOut = [true, true];
  game.round.part = 2;
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('Q','S'), ownerId: 0, wildAs: null },
    { card: card('Q','H'), ownerId: 0, wildAs: null },
    { card: card('Q','D'), ownerId: 0, wildAs: null },
  ]});
  // Force player 1 (index 1) to win the round via a last-card discard.
  game.round.current = 1;
  game.round.hands[1] = [card('2','C')];
  E.discard(game, '2C');
  if (!game.round.ended) throw new Error('test setup: round should have ended');
  const liveP0 = E.liveScore(game, 0);
  const liveP1 = E.liveScore(game, 1);
  if (liveP0 !== game.scores[0]) throw new Error(`liveScore(0)=${liveP0} should equal game.scores[0]=${game.scores[0]} once round ended`);
  if (liveP1 !== game.scores[1]) throw new Error(`liveScore(1)=${liveP1} should equal game.scores[1]=${game.scores[1]} once round ended`);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
