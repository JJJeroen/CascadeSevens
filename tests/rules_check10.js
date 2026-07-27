global.window = global;
require('../docs/engine.js');
require('../docs/ai.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit||''}`, rank, suit: suit||null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

check('AI finds a valuable pickup buried deep in the row, not just position 0', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.current = 1;
  game.round.comeOut[1] = true;
  // Row: 7C (junk, position 0) ... 3D,4D,5D (useful same-suit run, buried
  // deep -- scooping from 3D would take 5 cards total). The old AI never
  // looked past position 0 / never considered scoops > 2 cards.
  game.round.openRow = [
    card('7','C'), card('8','H'), card('A','S'), card('2','C'), card('3','D'), card('4','D'), card('5','D'),
  ];
  game.round.hands[1] = [card('K','H'), card('9','S')]; // don't already have a 3D/4D/5D-forming hand
  const draw = CascadeAI.pickDraw(game);
  if (draw.source !== 'row') throw new Error('AI should have taken from the row, took: ' + draw.source);
  if (draw.cardId !== '3D') throw new Error('AI should have targeted 3D (the useful buried run), took: ' + draw.cardId);
});

check('AI still declines when nothing in the row is actually resolvable', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.current = 1;
  game.round.comeOut[1] = true;
  game.round.openRow = [card('7','C'), card('8','H'), card('A','S')];
  game.round.hands[1] = [card('K','H'), card('9','S')];
  const draw = CascadeAI.pickDraw(game);
  if (draw.source !== 'closed') throw new Error('AI should have drawn from the closed pile, took: ' + draw.source);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
