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

// Undo pickup.
check('undoDraw restores the row and hand, clears the obligation', () => {
  const game = freshGameAtPart1();
  const beforeRow = game.round.openRow.length;
  const beforeHandLen = game.round.hands[0].length;
  const rowCard = game.round.openRow[game.round.openRow.length - 1];
  E.drawFromOpenRow(game, rowCard.id);
  if (!E.canUndoDraw(game)) throw new Error('canUndoDraw false right after a row pickup');
  E.undoDraw(game);
  if (game.round.part !== 1) throw new Error('did not return to Part 1');
  if (game.round.openRow.length !== beforeRow) throw new Error('row length not restored');
  if (game.round.hands[0].length !== beforeHandLen) throw new Error('hand length not restored');
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation not cleared');
  if (E.canUndoDraw(game)) throw new Error('canUndoDraw should be false after undoing');
});
check('undoDraw unavailable after a closed-pile draw', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  if (E.canUndoDraw(game)) throw new Error('should not be undoable — this was a closed-pile draw');
});
// Revised 2026-07-27: confirmed against the designer (via a real stuck-
// player report) that finishDrawing should NOT close the undo window on
// its own -- a player who clicks "Done drawing" before realizing they're
// stuck would otherwise be permanently stranded. Undo now survives the
// Part 1 -> Part 2 transition and reverts it too.
check('undoDraw survives finishDrawing and reverts the Part 1/2 transition too', () => {
  const game = freshGameAtPart1();
  const rowCard = game.round.openRow[game.round.openRow.length - 1];
  E.drawFromOpenRow(game, rowCard.id);
  E.finishDrawing(game);
  if (game.round.part !== 2) throw new Error('test setup: expected Part 2 after finishDrawing');
  if (!E.canUndoDraw(game)) throw new Error('undo should still be available after finishDrawing');
  E.undoDraw(game);
  if (game.round.part !== 1) throw new Error('undo should revert back to Part 1');
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation should be cleared');
});
check('undoDraw closes once an actual meld action succeeds', () => {
  const game = freshGameAtPart1();
  const rowCard = game.round.openRow[game.round.openRow.length - 1];
  E.drawFromOpenRow(game, rowCard.id);
  E.finishDrawing(game);
  const hand = game.round.hands[0];
  hand.push(card('K','S'), card('K','H'), card('K','D'));
  E.layNewMeld(game, [{cardId:'KS'},{cardId:'KH'},{cardId:'KD'}]);
  if (E.canUndoDraw(game)) throw new Error('undo should be closed off after a real meld action, even though finishDrawing alone did not close it');
});
check('undoDraw unavailable after any other Part 2 action', () => {
  const game = freshGameAtPart1();
  const rowCard = game.round.openRow[game.round.openRow.length - 1];
  E.drawFromOpenRow(game, rowCard.id);
  E.finishDrawing(game);
  // give the player an unrelated valid meld and lay it (not touching the obligated card)
  const hand = game.round.hands[game.round.current];
  hand.push(card('K','S'), card('K','H'), card('K','D'));
  E.layNewMeld(game, [{cardId:'KS'},{cardId:'KH'},{cardId:'KD'}]);
  if (E.canUndoDraw(game)) throw new Error('undo should be closed off after any other Part 2 action');
});

// Joker suit should never be required/stored for sets or runs anymore.
check('joker in a set carries no suit (no false duplicate-card display)', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand = game.round.hands[game.round.current];
  hand.length = 0;
  hand.push(card('A','S'), card('A','C'), { id: 'JOKER-1', rank: 'JOKER', suit: null }, card('2','H'));
  E.layNewMeld(game, [{cardId:'AS'},{cardId:'AC'},{cardId:'JOKER-1', wildAs:{rank:'A', suit:'S'}}]);
  const meld = game.round.tableau[0];
  const jokerSlot = meld.slots.find(s => s.card.rank === 'JOKER');
  if (jokerSlot.wildAs.suit) throw new Error('joker slot still carries a suit: ' + JSON.stringify(jokerSlot.wildAs));
});
check('joker fills a run without the caller pre-supplying a suit', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand = game.round.hands[game.round.current];
  hand.length = 0;
  hand.push(card('5','S'), card('6','S'), { id: 'JOKER-1', rank: 'JOKER', suit: null }, card('2','H'));
  // no suit supplied in wildAs at all -- only rank
  const r = E.validateNewMeldSelection(hand, [{cardId:'5S'},{cardId:'6S'},{cardId:'JOKER-1', wildAs:{rank:'7'}}]);
  if (!r.ok) throw new Error('run with joker (rank-only wildAs) rejected: ' + r.error);
  E.layNewMeld(game, [{cardId:'5S'},{cardId:'6S'},{cardId:'JOKER-1', wildAs:{rank:'7'}}]);
  const meld = game.round.tableau[0];
  const jokerSlot = meld.slots.find(s => s.card.rank === 'JOKER');
  if (jokerSlot.wildAs.suit) throw new Error('joker slot still carries a suit');
});
check('addToMeld: joker added to a run needs only rank, suit is implied', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run', type: 'run', slots: [
    { card: card('5','H'), ownerId: 1, wildAs: null },
    { card: card('6','H'), ownerId: 1, wildAs: null },
    { card: card('7','H'), ownerId: 1, wildAs: null },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push({ id: 'JOKER-1', rank: 'JOKER', suit: null });
  E.addToMeld(game, 'm-run', 'JOKER-1', { rank: '8' }); // no suit supplied
  const meld = game.round.tableau.find(m => m.id === 'm-run');
  const jokerSlot = meld.slots.find(s => s.card.rank === 'JOKER');
  if (!jokerSlot) throw new Error('joker was not added');
  if (jokerSlot.wildAs.suit) throw new Error('joker slot still carries a suit after addToMeld');
});
check('swapJoker on a run derives suit from the meld, not stored wildAs.suit', () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm-run2', type: 'run', slots: [
    { card: card('5','D'), ownerId: 1, wildAs: null },
    { card: card('6','D'), ownerId: 1, wildAs: null },
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
  ]});
  const hand = game.round.hands[game.round.current];
  hand.push(card('7','D'));
  E.swapJoker(game, 'm-run2', 'JOKER-1', '7D');
  const meld = game.round.tableau.find(m => m.id === 'm-run2');
  const replacedSlot = meld.slots.find(s => s.card.id === '7D');
  if (!replacedSlot) throw new Error('swap did not place the replacement card');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
