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

check('discard: the row-take obligation card may be discarded straight back instead of melded', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  if (game.round.pendingObligations[0] !== '9H') throw new Error('9H should be the pending obligation');
  if (game.round.rowObligationCardId !== '9H') throw new Error('rowObligationCardId should be set to 9H');
  E.finishDrawing(game);
  E.discard(game, '9H');
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation should be cleared by the discard');
  if (game.round.rowObligationCardId !== null) throw new Error('rowObligationCardId should be cleared too');
  if (!game.round.openRow.some((c) => c.id === '9H')) throw new Error('9H should be back in the open row');
});

check('discard: cannot discard a DIFFERENT card while the row obligation is still outstanding', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  E.finishDrawing(game);
  const otherCardId = game.round.hands[game.round.current][0].id;
  let threw = false;
  try { E.discard(game, otherCardId); } catch (e) { threw = true; }
  if (!threw) throw new Error('should refuse to discard anything other than the outstanding obligated card');
});

check('discard: a joker swap-out obligation may NOT be discarded back -- still must be melded', () => {
  const game = freshGameAtPart1();
  game.round.comeOut = [true, true];
  game.round.part = 2;
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
    { card: card('7', 'H'), ownerId: 1, wildAs: null },
    { card: card('7', 'D'), ownerId: 1, wildAs: null },
  ]});
  game.round.hands[0] = [card('7', 'S'), card('2', 'C')];
  E.swapJoker(game, 'm1', 'JOKER-1', '7S');
  if (game.round.pendingObligations[0] !== 'JOKER-1') throw new Error('joker should be the pending obligation');
  if (game.round.rowObligationCardId !== null) throw new Error('a swap obligation must not be marked discard-eligible');
  let threw = false;
  try { E.discard(game, 'JOKER-1'); } catch (e) { threw = true; }
  if (!threw) throw new Error('should refuse to discard the reclaimed joker -- it must be melded');
});

check('canProceedToDiscard: true when only the row obligation remains, false when a meld-only obligation remains', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  E.finishDrawing(game);
  if (!E.canProceedToDiscard(game)) throw new Error('should be able to proceed to discard (the row card itself is dischargeable)');

  game.round.pendingObligations = ['SOME_JOKER_ID'];
  game.round.rowObligationCardId = null;
  if (E.canProceedToDiscard(game)) throw new Error('should NOT be able to proceed while a meld-only obligation remains');
});

check('undoDraw restores rowObligationCardId correctly (repeated row-takes within one Part 1)', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('3', 'C'), card('9', 'H')];
  E.drawFromOpenRow(game, '9H'); // first take, obligation = 9H
  if (game.round.rowObligationCardId !== '9H') throw new Error('setup: expected 9H obligation');
  E.undoDraw(game);
  if (game.round.rowObligationCardId !== null) throw new Error('undo should restore rowObligationCardId to null (nothing was obligated before)');
  if (game.round.pendingObligations.length !== 0) throw new Error('undo should restore pendingObligations to empty');
});

check('a new row-take supersedes the previous one\'s discard-eligibility, not just its obligation id', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('3', 'C'), card('9', 'H')];
  E.drawFromOpenRow(game, '9H'); // take 1: obligation = 9H
  E.drawFromOpenRow(game, '3C'); // take 2 (repeat within Part 1): supersedes -- obligation = 3C only
  if (game.round.rowObligationCardId !== '3C') throw new Error('rowObligationCardId should now be 3C, not 9H');
  if (game.round.pendingObligations.length !== 1 || game.round.pendingObligations[0] !== '3C') {
    throw new Error('pendingObligations should contain only 3C');
  }
  // 9H is now just an ordinary hand card -- discarding it should be illegal
  // (3C is the only thing dischargeable), and discarding 3C should work.
  E.finishDrawing(game);
  let threw = false;
  try { E.discard(game, '9H'); } catch (e) { threw = true; }
  if (!threw) throw new Error('9H is no longer the obligation and should not be freely discardable');
  E.discard(game, '3C');
  if (game.round.pendingObligations.length !== 0) throw new Error('3C should have cleared the obligation');
});

check('canStartRearrange: allowed with an outstanding row obligation, blocked with a meld-only (joker) obligation', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  E.finishDrawing(game);
  game.round.comeOut[game.round.current] = true;
  if (!E.canStartRearrange(game)) throw new Error('should be allowed to start with only the row obligation outstanding');

  game.round.rowObligationCardId = null;
  game.round.pendingObligations = ['SOME_JOKER_ID'];
  if (E.canStartRearrange(game)) throw new Error('should still be blocked by a meld-only obligation');
});

check('commitRearrange: folding the row-obligated card into a valid group clears the obligation', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  E.finishDrawing(game);
  game.round.comeOut[game.round.current] = true;
  game.round.hands[game.round.current].push(card('7', 'H'), card('8', 'H'));
  E.startRearrange(game);
  // 9H (obligated), 7H, 8H form a valid run -- move them into one new group.
  E.rearrangeMoveCard(game, '9H', 'new');
  const state1 = E.rearrangeState(game);
  const newGroupId = state1.groups.find((g) => g.cardIds.includes('9H')).groupId;
  E.rearrangeMoveCard(game, '7H', newGroupId);
  E.rearrangeMoveCard(game, '8H', newGroupId);
  const result = E.commitRearrange(game);
  if (!result.ok) throw new Error('commit should succeed: ' + JSON.stringify(result.problems));
  if (game.round.pendingObligations.length !== 0) throw new Error('folding 9H into a valid run should clear the obligation');
  if (game.round.rowObligationCardId !== null) throw new Error('rowObligationCardId should be cleared too');
});

check('commitRearrange: leaving the row-obligated card in hand leaves the obligation outstanding after commit', () => {
  const game = freshGameAtPart1();
  game.round.openRow = [card('9', 'H')];
  E.drawFromOpenRow(game, '9H');
  E.finishDrawing(game);
  game.round.comeOut[game.round.current] = true;
  game.round.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('5', 'C'), ownerId: game.round.current, wildAs: null },
    { card: card('5', 'D'), ownerId: game.round.current, wildAs: null },
    { card: card('5', 'S'), ownerId: game.round.current, wildAs: null },
  ]});
  E.startRearrange(game);
  // A no-op session (commit without moving anything) -- 9H stays in the
  // hand pool the whole time, never placed into any group.
  const result = E.commitRearrange(game);
  if (!result.ok) throw new Error('commit should succeed: ' + JSON.stringify(result.problems));
  if (game.round.pendingObligations.length !== 1 || game.round.pendingObligations[0] !== '9H') {
    throw new Error('9H should still be an outstanding obligation since it was never placed in a group');
  }
  if (game.round.rowObligationCardId !== '9H') throw new Error('rowObligationCardId should still be 9H');
  // ...and it should still be resolvable afterward, e.g. by discarding it back.
  E.discard(game, '9H');
  if (game.round.pendingObligations.length !== 0) throw new Error('should still be able to discard 9H back after the session');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
