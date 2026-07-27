global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit||''}`, rank, suit: suit||null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart2() {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.comeOut = [true, true];
  game.round.part = 2;
  return game;
}

check('brutalcritic finding 1a: swapJoker refuses to run when it would strand the joker as an unmeldable last card', () => {
  const game = freshGameAtPart2();
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
    { card: card('7', 'H'), ownerId: 1, wildAs: null },
    { card: card('7', 'D'), ownerId: 1, wildAs: null },
  ]});
  // Hand down to exactly the replacement card -- the exact trap scenario.
  game.round.hands[0] = [card('7', 'S')];
  let threw = false;
  try { E.swapJoker(game, 'm1', 'JOKER-1', '7S'); } catch (e) { threw = true; }
  if (!threw) throw new Error('swap should have been refused -- it would strand the joker as an unmeldable last card');
  if (game.round.hands[0].length !== 1 || game.round.hands[0][0].id !== '7S') {
    throw new Error('a refused swap must not mutate hand/tableau at all');
  }
  if (game.round.pendingObligations.length !== 0) throw new Error('a refused swap must not leave a dangling obligation');
});

check('brutalcritic finding 1a (control): the same swap succeeds with one spare card in hand', () => {
  const game = freshGameAtPart2();
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
    { card: card('7', 'H'), ownerId: 1, wildAs: null },
    { card: card('7', 'D'), ownerId: 1, wildAs: null },
  ]});
  game.round.hands[0] = [card('7', 'S'), card('2', 'C')]; // one spare card besides the replacement
  E.swapJoker(game, 'm1', 'JOKER-1', '7S');
  if (game.round.pendingObligations.length !== 1) throw new Error('joker should now be a pending obligation');
  // ...and the obligation must itself still be resolvable: add the joker
  // to a fresh meld isn't possible alone, but adding it to an existing
  // meld while the spare card remains behind must work.
  game.round.tableau.push({ id: 'm2', type: 'set', slots: [
    { card: card('9', 'H'), ownerId: 1, wildAs: null },
    { card: card('9', 'D'), ownerId: 1, wildAs: null },
  ]});
  E.addToMeld(game, 'm2', 'JOKER-1', { rank: '9' });
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation should now be cleared');
  if (game.round.hands[0].length !== 1) throw new Error('exactly the spare card should remain');
});

check('brutalcritic finding 1b: addToMeld refuses to strand an untouched row-take obligation', () => {
  const game = freshGameAtPart2();
  game.round.pendingObligations = ['XC']; // simulates an outstanding row-take obligation
  game.round.hands[0] = [card('X_placeholder'), card('5', 'D')];
  // give the obligated card its real id
  game.round.hands[0][0] = card('K', 'C'); game.round.hands[0][0].id = 'XC';
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('5', 'H'), ownerId: 1, wildAs: null },
    { card: card('5', 'S'), ownerId: 1, wildAs: null },
  ]});
  // Trying to add the NON-obligated card (5D) would leave hand=[XC] alone
  // -- exactly the stranding trap -- so it must be refused.
  let threw = false;
  try { E.addToMeld(game, 'm1', '5D'); } catch (e) { threw = true; }
  if (!threw) throw new Error('should have refused -- this would strand the obligated card XC as the sole remaining card');
  if (game.round.hands[0].length !== 2) throw new Error('a refused add must not mutate hand at all');
});

check('brutalcritic finding 1b (control): adding the obligated card itself, leaving the spare, still works', () => {
  const game = freshGameAtPart2();
  game.round.pendingObligations = ['KC'];
  game.round.hands[0] = [card('K', 'C'), card('5', 'D')];
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('K', 'H'), ownerId: 1, wildAs: null },
    { card: card('K', 'S'), ownerId: 1, wildAs: null },
  ]});
  E.addToMeld(game, 'm1', 'KC');
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation should be cleared');
  if (game.round.hands[0].length !== 1 || game.round.hands[0][0].id !== '5D') throw new Error('the spare card should remain, ready to discard');
  E.discard(game, '5D');
  if (!game.round.ended) throw new Error('round should end via the natural last-card discard');
});

check('brutalcritic finding 1: layNewMeld refuses a selection that would strand an unselected obligation', () => {
  const game = freshGameAtPart2();
  game.round.pendingObligations = ['9C'];
  game.round.hands[0] = [card('9', 'C'), card('J', 'H'), card('J', 'D'), card('J', 'S')];
  // Laying J,J,J leaves hand=[9C] alone with the obligation still pending
  // -- the trap -- so it must be refused even though it doesn't touch the
  // obligated card and isn't using the "entire hand" in the old sense.
  let threw = false;
  try { E.layNewMeld(game, [{ cardId: 'JH' }, { cardId: 'JD' }, { cardId: 'JS' }]); } catch (e) { threw = true; }
  if (!threw) throw new Error('should have refused -- this strands the obligated 9C as the sole remaining card');
  if (game.round.hands[0].length !== 4) throw new Error('a refused layNewMeld must not mutate hand at all');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
