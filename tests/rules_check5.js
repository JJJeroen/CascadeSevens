global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit||''}`, rank, suit: suit||null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart1() {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  return game;
}

check('come-out progress carries forward across turns (not reset each turn)', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand = game.round.hands[0];
  hand.push(card('Q','S'), card('Q','H'), card('Q','D')); // 30 points, below the 40 bar
  E.layNewMeld(game, [{cardId:'QS'},{cardId:'QH'},{cardId:'QD'}]);
  if (game.round.comeOut[0]) throw new Error('should not have come out at 30 points');
  E.discard(game, hand[0].id); // end player 0's turn
  // player 1 (AI-less, manual) takes a full turn and passes back
  E.drawFromClosedPile(game);
  E.discard(game, game.round.hands[1][0].id);
  // back to player 0 -- lay a second meld worth 10+ to cross 40 total
  if (game.round.current !== 0) throw new Error('test setup: expected it to be player 0 turn again');
  E.drawFromClosedPile(game);
  const hand2 = game.round.hands[0];
  hand2.push(card('K','S'), card('K','H'), card('K','D'));
  E.layNewMeld(game, [{cardId:'KS'},{cardId:'KH'},{cardId:'KD'}]); // +30 -> 60 total across two turns
  if (!game.round.comeOut[0]) throw new Error('should have come out: 30 (earlier turn) + 30 (this turn) = 60 >= 40');
});

check('comeOutAccum is tracked independently per player', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand0 = game.round.hands[0];
  hand0.push(card('9','S'), card('9','H'), card('9','D')); // 15 points, player 0
  E.layNewMeld(game, [{cardId:'9S'},{cardId:'9H'},{cardId:'9D'}]);
  E.discard(game, hand0[0].id);
  if (game.round.comeOutAccum[0] !== 15) throw new Error('player 0 accum wrong: ' + game.round.comeOutAccum[0]);
  if (game.round.comeOutAccum[1] !== 0) throw new Error('player 1 accum should be untouched: ' + game.round.comeOutAccum[1]);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
