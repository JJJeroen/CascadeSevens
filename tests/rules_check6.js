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

check('addToMeld: extending the LOW end prepends, not appends (display order)', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run', type: 'run', slots: [
    { card: card('10','S'), ownerId: 0, wildAs: null },
    { card: card('J','S'), ownerId: 0, wildAs: null },
    { card: card('Q','S'), ownerId: 0, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('9','S'));
  E.addToMeld(game, 'm-run', '9S');
  const order = game.round.tableau[0].slots.map(s => s.card.rank);
  if (order.join(',') !== '9,10,J,Q') throw new Error('expected 9,10,J,Q order, got ' + order.join(','));
});
check('addToMeld: extending the HIGH end still appends correctly', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run2', type: 'run', slots: [
    { card: card('10','S'), ownerId: 0, wildAs: null },
    { card: card('J','S'), ownerId: 0, wildAs: null },
    { card: card('Q','S'), ownerId: 0, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('K','S'));
  E.addToMeld(game, 'm-run2', 'KS');
  const order = game.round.tableau[0].slots.map(s => s.card.rank);
  if (order.join(',') !== '10,J,Q,K') throw new Error('expected 10,J,Q,K order, got ' + order.join(','));
});
check('addToMeld: low-end extension keeps the meld valid for further extension', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run3', type: 'run', slots: [
    { card: card('10','S'), ownerId: 0, wildAs: null },
    { card: card('J','S'), ownerId: 0, wildAs: null },
    { card: card('Q','S'), ownerId: 0, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('9','S'), card('8','S'));
  E.addToMeld(game, 'm-run3', '9S');
  E.addToMeld(game, 'm-run3', '8S');
  const order = game.round.tableau[0].slots.map(s => s.card.rank);
  if (order.join(',') !== '8,9,10,J,Q') throw new Error('expected 8,9,10,J,Q order, got ' + order.join(','));
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
