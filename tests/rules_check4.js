global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit||''}`, rank, suit: suit||null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart1(openRowCards) {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  if (openRowCards) game.round.openRow = openRowCards;
  return game;
}

// Repeatable open-row draws in Part 1.
check('row draw can repeat; closed pile locks out after the first row draw', () => {
  const game = freshGameAtPart1([card('2','S'), card('3','S'), card('4','S'), card('5','S')]);
  if (!E.canDrawFromClosedPile(game)) throw new Error('closed pile should be available before any draw');
  E.drawFromOpenRow(game, '5S');
  if (game.round.part !== 1) throw new Error('should still be in Part 1 after a row draw');
  if (E.canDrawFromClosedPile(game)) throw new Error('closed pile should now be locked out');
  let threw = false;
  try { E.drawFromClosedPile(game); } catch (e) { threw = true; }
  if (!threw) throw new Error('drawFromClosedPile should have thrown once locked out');
  // repeat: take again
  if (!E.canDrawFromRow(game)) throw new Error('row should still be drawable');
  const handLenBefore = game.round.hands[0].length;
  E.drawFromOpenRow(game, '4S');
  if (game.round.hands[0].length !== handLenBefore + 1) throw new Error('second scoop should add exactly 1 card to hand');
});

check('only the most recent row draw is the binding obligation', () => {
  const game = freshGameAtPart1([card('2','S'), card('3','S'), card('4','S'), card('5','S')]);
  E.drawFromOpenRow(game, '5S');
  if (JSON.stringify(game.round.pendingObligations) !== JSON.stringify(['5S'])) throw new Error('first obligation wrong');
  E.drawFromOpenRow(game, '4S');
  if (JSON.stringify(game.round.pendingObligations) !== JSON.stringify(['4S'])) throw new Error('obligation should be replaced, not accumulated: ' + JSON.stringify(game.round.pendingObligations));
});

check('canFinishDrawing / finishDrawing gate correctly', () => {
  const game = freshGameAtPart1([card('9','H')]);
  if (E.canFinishDrawing(game)) throw new Error('should not be able to finish before any draw');
  E.drawFromOpenRow(game, '9H');
  if (!E.canFinishDrawing(game)) throw new Error('should be able to finish after a row draw');
  E.finishDrawing(game);
  if (game.round.part !== 2) throw new Error('finishDrawing should move to Part 2');
});

check('undo restores closed-pile availability if it was the only row draw', () => {
  const game = freshGameAtPart1([card('9','H')]);
  E.drawFromOpenRow(game, '9H');
  if (E.canDrawFromClosedPile(game)) throw new Error('should be locked out right after the draw');
  E.undoDraw(game);
  if (!E.canDrawFromClosedPile(game)) throw new Error('undo should restore closed-pile availability');
});

check('undo after a repeat draw restores the PREVIOUS obligation, not none', () => {
  const game = freshGameAtPart1([card('2','S'), card('3','S'), card('4','S'), card('5','S')]);
  E.drawFromOpenRow(game, '5S');
  E.drawFromOpenRow(game, '4S');
  E.undoDraw(game); // undo only the most recent (4S) draw
  if (JSON.stringify(game.round.pendingObligations) !== JSON.stringify(['5S'])) {
    throw new Error('expected obligation to revert to 5S, got ' + JSON.stringify(game.round.pendingObligations));
  }
});

// autoResolveMeld
check('autoResolveMeld: pure set, no jokers', () => {
  const hand = [card('7','S'), card('7','H'), card('7','D'), card('2','C')];
  const r = E.autoResolveMeld(hand, ['7S','7H','7D']);
  if (!r.ok || r.type !== 'set') throw new Error('expected a set: ' + JSON.stringify(r));
});
check('autoResolveMeld: set with a joker, rank auto-assigned', () => {
  const hand = [card('7','S'), card('7','H'), {id:'JOKER-1',rank:'JOKER',suit:null}];
  const r = E.autoResolveMeld(hand, ['7S','7H','JOKER-1']);
  if (!r.ok || r.type !== 'set') throw new Error('expected a set: ' + JSON.stringify(r));
  const jokerSlot = r.slots.find(s => s.cardId === 'JOKER-1');
  if (jokerSlot.wildAs.rank !== '7') throw new Error('joker should represent rank 7');
});
check('autoResolveMeld: run with a joker filling an internal gap', () => {
  const hand = [card('5','S'), card('6','S'), card('8','S'), {id:'JOKER-1',rank:'JOKER',suit:null}];
  const r = E.autoResolveMeld(hand, ['5S','6S','8S','JOKER-1']);
  if (!r.ok || r.type !== 'run') throw new Error('expected a run: ' + JSON.stringify(r));
  const jokerSlot = r.slots.find(s => s.cardId === 'JOKER-1');
  if (jokerSlot.wildAs.rank !== '7') throw new Error('joker should fill the gap at 7, got ' + jokerSlot.wildAs.rank);
});
check('autoResolveMeld: run with 2 jokers extending beyond the reals', () => {
  const hand = [card('5','S'), card('6','S'), {id:'JOKER-1',rank:'JOKER',suit:null}, {id:'JOKER-2',rank:'JOKER',suit:null}];
  const r = E.autoResolveMeld(hand, ['5S','6S','JOKER-1','JOKER-2']);
  if (!r.ok || r.type !== 'run') throw new Error('expected a run: ' + JSON.stringify(r));
  // verify it actually validates end-to-end through the real validator
  const check2 = E.validateNewMeldSelection(hand, r.slots);
  if (!check2.ok) throw new Error('autoResolveMeld produced a selection the real validator rejects: ' + check2.error);
});
check('autoResolveMeld: Q-K-A ace-high anchor via a joker', () => {
  const hand = [card('K','S'), card('A','S'), {id:'JOKER-1',rank:'JOKER',suit:null}];
  const r = E.autoResolveMeld(hand, ['KS','AS','JOKER-1']);
  if (!r.ok) throw new Error('expected Q-K-A to resolve: ' + JSON.stringify(r));
  const check2 = E.validateNewMeldSelection(hand, r.slots);
  if (!check2.ok) throw new Error('produced selection rejected by real validator: ' + check2.error);
});
check('autoResolveMeld: no wraparound (K,A,2 impossible even with help)', () => {
  const hand = [card('K','S'), card('A','S'), card('2','S')];
  const r = E.autoResolveMeld(hand, ['KS','AS','2S']);
  if (r.ok) throw new Error('K-A-2 wraparound should never resolve, got ' + JSON.stringify(r));
});
check('autoResolveMeld: genuinely impossible selection fails cleanly', () => {
  const hand = [card('2','H'), card('9','C'), card('Q','D')];
  const r = E.autoResolveMeld(hand, ['2H','9C','QD']);
  if (r.ok) throw new Error('should not resolve — no shared rank or suit');
});

// autoResolveAddToMeld
check('autoResolveAddToMeld: joker into a set uses the set rank', () => {
  const meld = { type: 'set', slots: [
    { card: card('9','S'), ownerId: 0, wildAs: null },
    { card: card('9','H'), ownerId: 0, wildAs: null },
    { card: card('9','D'), ownerId: 0, wildAs: null },
  ]};
  const r = E.autoResolveAddToMeld(meld, {id:'JOKER-1',rank:'JOKER',suit:null});
  if (!r || r.wildAs.rank !== '9') throw new Error('expected rank 9: ' + JSON.stringify(r));
});
check('autoResolveAddToMeld: joker into a run picks a legal end', () => {
  const meld = { type: 'run', slots: [
    { card: card('5','H'), ownerId: 0, wildAs: null },
    { card: card('6','H'), ownerId: 0, wildAs: null },
    { card: card('7','H'), ownerId: 0, wildAs: null },
  ]};
  const r = E.autoResolveAddToMeld(meld, {id:'JOKER-1',rank:'JOKER',suit:null});
  if (!r || (r.wildAs.rank !== '4' && r.wildAs.rank !== '8')) throw new Error('expected an end extension: ' + JSON.stringify(r));
});
check('autoResolveAddToMeld: non-joker card needs no wildAs', () => {
  const meld = { type: 'set', slots: [{ card: card('9','S'), ownerId: 0, wildAs: null }] };
  const r = E.autoResolveAddToMeld(meld, card('9','H'));
  if (!r || r.wildAs !== undefined) throw new Error('real card should not get a wildAs: ' + JSON.stringify(r));
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
