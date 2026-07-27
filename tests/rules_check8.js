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

check('addToMeld: joker repositions to make room for a non-adjacent card (the exact reported scenario)', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  // Run: JOKER(as 9), 10, J  -- owned by player 1 (opponent), except the
  // joker which we'll say was placed by player 0 to make ownership
  // preservation meaningfully testable.
  game.round.tableau.push({ id: 'm-run', type: 'run', slots: [
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 0, wildAs: { rank: '9' } },
    { card: card('10','S'), ownerId: 1, wildAs: null },
    { card: card('J','S'), ownerId: 1, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('K','S'));
  E.addToMeld(game, 'm-run', 'KS');
  const meld = game.round.tableau.find(m => m.id === 'm-run');
  const order = meld.slots.map(s => s.card.rank === 'JOKER' ? `J->${s.wildAs.rank}` : s.card.rank);
  if (order.join(',') !== '10,J,J->Q,K') throw new Error('expected 10,J,J->Q,K, got ' + order.join(','));
  const jokerSlot = meld.slots.find(s => s.card.rank === 'JOKER');
  if (jokerSlot.ownerId !== 0) throw new Error('joker should keep its original owner (0), got ' + jokerSlot.ownerId);
  const kSlot = meld.slots.find(s => s.card.id === 'KS');
  if (kSlot.ownerId !== game.round.current) throw new Error('the newly added K should be owned by the adding player');
  const tenSlot = meld.slots.find(s => s.card.id === '10S');
  if (tenSlot.ownerId !== 1) throw new Error('pre-existing real card should keep its original owner (1)');
});

check('addToMeld: still rejects when no repositioning makes it valid', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run2', type: 'run', slots: [
    { card: card('5','H'), ownerId: 1, wildAs: null },
    { card: card('6','H'), ownerId: 1, wildAs: null },
    { card: card('7','H'), ownerId: 1, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('K','H')); // no joker available to bridge the huge gap
  let threw = false;
  try { E.addToMeld(game, 'm-run2', 'KH'); } catch (e) { threw = true; }
  if (!threw) throw new Error('should still reject an unreachable extension with no joker to help');
});

check('addToMeld: joker at the low end slides to fill a gap opened by the new high card', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  // Run: JOKER(as 2),3,4 -- adding a 6 leaves a gap at 5; the joker should
  // slide from representing 2 to representing 5 rather than being rejected.
  game.round.tableau.push({ id: 'm-run4', type: 'run', slots: [
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '2' } },
    { card: card('3','C'), ownerId: 1, wildAs: null },
    { card: card('4','C'), ownerId: 1, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('6','C'));
  E.addToMeld(game, 'm-run4', '6C');
  const meld = game.round.tableau.find(m => m.id === 'm-run4');
  const order = meld.slots.map(s => s.card.rank === 'JOKER' ? `J->${s.wildAs.rank}` : s.card.rank);
  if (order.join(',') !== '3,4,J->5,6') throw new Error('expected 3,4,J->5,6, got ' + order.join(','));
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
