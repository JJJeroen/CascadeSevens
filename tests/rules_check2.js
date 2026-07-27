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

// 1. Open row draw allowed before come-out.
check('can draw from open row before come-out', () => {
  const game = freshGameAtPart1();
  if (!E.canDrawFromRow(game)) throw new Error('canDrawFromRow false before come-out');
  const before = game.round.openRow.length;
  const rowCard = game.round.openRow[game.round.openRow.length - 1];
  E.drawFromOpenRow(game, rowCard.id);
  if (game.round.part !== 1) throw new Error('row take should stay in Part 1 (repeatable) until finishDrawing()');
  E.finishDrawing(game);
  if (game.round.part !== 2) throw new Error('did not advance to part 2 after finishDrawing');
  if (!game.round.pendingObligations.includes(rowCard.id)) throw new Error('no obligation created');
});

// 2. Turn 0 asymmetry.
// Revised 2026-07-27: confirmed against the designer that taking the
// starter card "uses up" that player's go, so Turn 1 goes to whoever did
// NOT make the last accepted swap -- not always back to the starter.
check('turn0: P1 (starter) accepts immediately -> no follow-up, Turn 1 goes to P2', () => {
  const game = E.newGame('standard', () => 0.1); // starter = 0
  E.startRound(game, () => 0.5);
  const swapCard = game.round.hands[0][0].id;
  E.turn0Accept(game, swapCard);
  if (E.turn0CurrentAskee(game) !== null) throw new Error('P2 still being offered a follow-up');
  if (game.round.part !== 1 || game.round.current !== 1) throw new Error('Turn 1 should go to P2 (the non-acceptor), got current=' + game.round.current);
});
check('turn0: P1 declines, P2 accepts -> P1 gets a follow-up', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  if (E.turn0CurrentAskee(game) !== 1) throw new Error('P2 not offered after P1 declined');
  const swapCard = game.round.hands[1][0].id;
  E.turn0Accept(game, swapCard);
  if (E.turn0CurrentAskee(game) !== 0) throw new Error('P1 not offered the consolation follow-up');
});
check('turn0: P1 declines, P2 accepts, P1 declines followup -> Turn 1 goes to P1', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  const swapCard = game.round.hands[1][0].id;
  E.turn0Accept(game, swapCard); // P2 is now the last acceptor
  E.turn0Decline(game); // P1 declines the consolation look
  if (game.round.current !== 0) throw new Error('Turn 1 should go to P1 (opponent of the last acceptor, P2), got ' + game.round.current);
});
check('turn0: P1 declines, P2 accepts, P1 ALSO accepts the followup -> Turn 1 goes to P2', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Accept(game, game.round.hands[1][0].id); // P2 accepts
  E.turn0Accept(game, game.round.hands[0][0].id); // P1 ALSO accepts the followup -- now P1 is the last acceptor
  if (game.round.current !== 1) throw new Error('Turn 1 should go to P2 (opponent of the last acceptor, P1), got ' + game.round.current);
});
check('turn0: P1 declines, P2 declines -> no trigger, row length 1, starter begins Turn 1', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  if (game.round.openRow.length !== 1) throw new Error('row length ' + game.round.openRow.length);
  if (game.round.part !== 1) throw new Error('did not begin normal rotation');
  if (game.round.current !== 0) throw new Error('nobody accepted anything -- the original starter should begin Turn 1, got ' + game.round.current);
});

// 3. Cannot empty hand via layNewMeld.
check('layNewMeld rejects using the entire hand', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand = game.round.hands[game.round.current];
  hand.length = 0;
  hand.push(card('2','S'), card('2','H'), card('2','D'));
  let threw = false;
  try { E.layNewMeld(game, hand.map(c => ({ cardId: c.id }))); } catch (e) { threw = true; }
  if (!threw) throw new Error('was allowed to lay entire 3-card hand as a meld');
});

// 4. Cannot add last card via addToMeld.
check('addToMeld rejects the last card in hand', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.tableau.push({ id: 'm-test', type: 'set', slots: [
    { card: card('7','S'), ownerId: 1, wildAs: null },
    { card: card('7','H'), ownerId: 1, wildAs: null },
    { card: card('7','D'), ownerId: 1, wildAs: null },
  ]});
  game.round.comeOut[game.round.current] = true;
  const hand = game.round.hands[game.round.current];
  hand.length = 0;
  hand.push(card('7','C'));
  let threw = false;
  try { E.addToMeld(game, 'm-test', '7C'); } catch (e) { threw = true; }
  if (!threw) throw new Error('was allowed to add the only card in hand');
});

// 5. pullFromMeld: edge removal legal, middle removal illegal, full dissolve legal, ownership transfer.
check('pullFromMeld: removing a run edge card is legal', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run', type: 'run', slots: [
    { card: card('4','S'), ownerId: 0, wildAs: null },
    { card: card('5','S'), ownerId: 0, wildAs: null },
    { card: card('6','S'), ownerId: 0, wildAs: null },
    { card: card('7','S'), ownerId: 0, wildAs: null },
  ]});
  E.pullFromMeld(game, 'm-run', '7S');
  const meld = game.round.tableau.find(m => m.id === 'm-run');
  if (meld.slots.length !== 3) throw new Error('expected 3 remaining, got ' + meld.slots.length);
  const hand = game.round.hands[game.round.current];
  if (!hand.some(c => c.id === '7S')) throw new Error('pulled card not returned to hand');
});
check('pullFromMeld: removing a run middle card is illegal', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run2', type: 'run', slots: [
    { card: card('4','S'), ownerId: 0, wildAs: null },
    { card: card('5','S'), ownerId: 0, wildAs: null },
    { card: card('6','S'), ownerId: 0, wildAs: null },
    { card: card('7','S'), ownerId: 0, wildAs: null },
  ]});
  let threw = false;
  let msg = '';
  try { E.pullFromMeld(game, 'm-run2', '5S'); } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error('was allowed to split a run by pulling a middle card');
  if (msg.includes('credited to the other player')) throw new Error('rejected for the wrong reason (ownership, not the middle-split rule): ' + msg);
});
check('pullFromMeld: pulling down to 2 cards is illegal', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-set3', type: 'set', slots: [
    { card: card('9','S'), ownerId: 0, wildAs: null },
    { card: card('9','H'), ownerId: 0, wildAs: null },
    { card: card('9','D'), ownerId: 0, wildAs: null },
  ]});
  let threw = false;
  try { E.pullFromMeld(game, 'm-set3', '9S'); } catch (e) { threw = true; }
  if (!threw) throw new Error('was allowed to shrink a set below 3 cards');
});
check('pullFromMeld: atomic multi-card pull fully dissolves a meld', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run4', type: 'run', slots: [
    { card: card('4','S'), ownerId: 0, wildAs: null },
    { card: card('5','S'), ownerId: 0, wildAs: null },
    { card: card('6','S'), ownerId: 0, wildAs: null },
  ]});
  // A single-card pull would leave 2 (illegal) -- but pulling all 3 at once dissolves it cleanly.
  let singleThrew = false;
  try { E.pullFromMeld(game, 'm-run4', '6S'); } catch (e) { singleThrew = true; }
  if (!singleThrew) throw new Error('single-card pull from a 3-card meld should have been rejected');
  E.pullFromMeld(game, 'm-run4', ['4S', '5S', '6S']);
  if (game.round.tableau.some(m => m.id === 'm-run4')) throw new Error('meld should have been removed from the tableau');
  const hand = game.round.hands[game.round.current];
  if (!['4S','5S','6S'].every(id => hand.some(c => c.id === id))) throw new Error('all 3 cards should be back in hand');
});
check('pullFromMeld requires come-out', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.tableau.push({ id: 'm-gate', type: 'set', slots: [
    { card: card('3','S'), ownerId: 1, wildAs: null },
    { card: card('3','H'), ownerId: 1, wildAs: null },
    { card: card('3','D'), ownerId: 1, wildAs: null },
  ]});
  let threw = false;
  try { E.pullFromMeld(game, 'm-gate', '3S'); } catch (e) { threw = true; }
  if (!threw) throw new Error('pullFromMeld allowed before come-out');
});
// Revised 2026-07-27: confirmed against the designer that pulling is
// restricted to cards the CURRENT player themselves placed -- pulling the
// opponent's cards is illegal, even though either player can freely ADD to
// any meld. This retires the old "ownership transfers via pull-relay"
// premise (that's no longer reachable at all -- you can only ever pull,
// and therefore only ever re-lay, cards that were already yours).
check('pullFromMeld rejects pulling a card owned by the other player', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-mixed', type: 'set', slots: [
    { card: card('K','S'), ownerId: 1, wildAs: null }, // opponent's
    { card: card('K','H'), ownerId: 1, wildAs: null }, // opponent's
    { card: card('K','D'), ownerId: 0, wildAs: null }, // mine
    { card: card('K','C'), ownerId: 0, wildAs: null }, // mine
  ]});
  let threw = false;
  let msg = '';
  try { E.pullFromMeld(game, 'm-mixed', 'KS'); } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error('was allowed to pull a card owned by the other player');
  if (!msg.includes('credited to the other player')) throw new Error('wrong rejection reason: ' + msg);
  // but pulling MY OWN card from the same mixed meld should still work
  // (pulling just 1 of my 2 leaves 3 behind -- opponent's 2 + my other 1 --
  // still a valid set; pulling both of mine would leave only 2, illegal
  // for an unrelated reason, so this deliberately tests just one)
  E.pullFromMeld(game, 'm-mixed', 'KD');
  const hand = game.round.hands[game.round.current];
  if (!hand.some(c => c.id === 'KD')) throw new Error('own card from a mixed meld should have been pullable');
});
check('re-laying a pulled (own) card keeps the same owner', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-own', type: 'set', slots: [
    { card: card('K','S'), ownerId: 0, wildAs: null },
    { card: card('K','H'), ownerId: 0, wildAs: null },
    { card: card('K','D'), ownerId: 0, wildAs: null },
    { card: card('K','C'), ownerId: 0, wildAs: null },
  ]});
  E.pullFromMeld(game, 'm-own', 'KS');
  const hand = game.round.hands[game.round.current];
  hand.push(card('K','_extra1'), card('K','_extra2'));
  E.layNewMeld(game, [{cardId:'KS'},{cardId:'K_extra1'},{cardId:'K_extra2'}]);
  const meldNow = game.round.tableau.find(m => m.slots.some(s => s.card.id === 'KS'));
  const slot = meldNow.slots.find(s => s.card.id === 'KS');
  if (slot.ownerId !== game.round.current) throw new Error('re-laid card should still be owned by the same (only possible) player');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
