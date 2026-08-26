// Critical-tier: four-of-a-kind as an alternate come-out route (DESIGN.md
// §2.4 -- "four cards of the same rank, regardless of point value"). A
// four-of-a-kind of low cards (e.g. four 2s = 20 points) satisfies come-out
// on its own even though it's well under the normal 40-point bar. Confirmed
// by grep before writing this file: zero matches for "fourOfAKind" (or any
// equivalent) existed anywhere in tests/ -- this named rule had no coverage
// at all.
global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit || ''}`, rank, suit: suit || null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart2() {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.part = 2;
  return game;
}

check('four-of-a-kind comes out immediately regardless of point total', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.hands[0] = [card('2', 'H'), card('2', 'D'), card('2', 'C'), card('2', 'S'), card('9', 'H')];

  E.layNewMeld(game, [{ cardId: '2H' }, { cardId: '2D' }, { cardId: '2C' }, { cardId: '2S' }]);

  if (r.comeOutAccum[0] !== 20) throw new Error('accum should just be the meld value (20), got ' + r.comeOutAccum[0]);
  if (!r.comeOut[0]) throw new Error('player should have come out via four-of-a-kind despite only 20 points');
});

check('control: an ordinary 3-card set below 40 points does NOT come out', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.hands[0] = [card('2', 'H'), card('2', 'D'), card('2', 'C'), card('9', 'H')];

  E.layNewMeld(game, [{ cardId: '2H' }, { cardId: '2D' }, { cardId: '2C' }]);

  if (r.comeOut[0]) throw new Error('a 15-point 3-card set alone should not trigger come-out');
  if (r.comeOutAccum[0] !== 15) throw new Error('accum should still track the 15 points toward a future 40, got ' + r.comeOutAccum[0]);
});

check('four-of-a-kind with a joker standing in still counts as four cards for the shortcut', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  // 3 reals of low value + 1 joker: value alone (5+5+5+50=65) would already
  // cross 40, so also prove the shortcut path specifically by using cards
  // that make BOTH routes true at once is not a clean isolation -- instead
  // confirm isFourOfAKind is computed from slot COUNT (4), not real-card
  // count, by checking the meld actually recorded 4 slots.
  r.hands[0] = [card('2', 'H'), card('2', 'D'), card('2', 'C'), { id: 'JOKER-1', rank: 'JOKER', suit: null }, card('9', 'H')];
  E.layNewMeld(game, [{ cardId: '2H' }, { cardId: '2D' }, { cardId: '2C' }, { cardId: 'JOKER-1', wildAs: { rank: '2' } }]);
  if (r.tableau[0].slots.length !== 4) throw new Error('meld should have 4 slots (3 real + 1 joker)');
  if (!r.comeOut[0]) throw new Error('should have come out (crosses 40 via value here regardless, but confirms 4-slot melds are accepted)');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
