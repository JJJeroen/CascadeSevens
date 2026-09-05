// Medium-tier: round-boundary state reset. Every round-scoped field must
// come back clean at startRound, even immediately after a previous round
// that accumulated heavy state (a met come-out, non-zero comeOutAccum, a
// non-empty tableau) -- as opposed to the previously-fixed comeOutAccum bug,
// which was about NOT resetting something that should reset PER TURN. This
// is the opposite direction: confirming round-scoped fields DO reset, while
// game-scoped fields (game.scores, game.roundNumber) correctly do NOT.
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

check('starting a new round resets all round-scoped state, even after heavy accumulation in the previous round', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('5', 'H'), ownerId: 0, wildAs: null },
    { card: card('5', 'D'), ownerId: 0, wildAs: null },
    { card: card('5', 'C'), ownerId: 0, wildAs: null },
  ] });
  r.comeOut = [true, false];
  r.comeOutAccum = [40, 15];
  r.hands[0] = [card('2', 'C')];
  r.hands[1] = [card('9', 'D')];
  E.discard(game, '2C'); // ends round 1, player 0 wins
  if (!game.round.ended) throw new Error('test setup: round 1 should have ended');
  const scoresAfterRound1 = game.scores.slice();

  E.startRound(game, () => 0.5); // round 2
  const r2 = game.round;

  if (r2.tableau.length !== 0) throw new Error('tableau should be empty at the start of a new round');
  if (r2.comeOut[0] !== false || r2.comeOut[1] !== false) throw new Error('comeOut should reset to [false,false]');
  if (r2.comeOutAccum[0] !== 0 || r2.comeOutAccum[1] !== 0) throw new Error('comeOutAccum should reset to [0,0]');
  if (r2.pendingObligations.length !== 0) throw new Error('pendingObligations should be empty');
  if (r2.rowObligationCardId !== null) throw new Error('rowObligationCardId should reset to null');
  if (r2.rearrange !== null) throw new Error('rearrange session should reset to null');
  if (r2.part !== 'turn0') throw new Error("a new round should start at Turn 0, got '" + r2.part + "'");
  if (r2.ended) throw new Error('a new round should not start already ended');
  if (r2.roundWinner !== null) throw new Error('roundWinner should reset to null');
  if (r2.hands[0].length !== 7 || r2.hands[1].length !== 7) throw new Error('both hands should be freshly dealt to 7 cards');
  if (game.roundNumber !== 2) throw new Error('roundNumber should increment to 2, got ' + game.roundNumber);
  if (game.scores[0] !== scoresAfterRound1[0] || game.scores[1] !== scoresAfterRound1[1]) {
    throw new Error('the PERSISTED game.scores must carry over across rounds, not reset');
  }
});

check('a new round is dealt from a fresh 54-card shuffle, with nothing left over from the previous round', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.tableau.push({ id: 'm1', type: 'run', slots: [
    { card: card('5', 'H'), ownerId: 0, wildAs: null },
    { card: card('6', 'H'), ownerId: 0, wildAs: null },
    { card: card('7', 'H'), ownerId: 0, wildAs: null },
  ] });
  r.hands[0] = [card('2', 'C')];
  r.hands[1] = [card('9', 'D')];
  E.discard(game, '2C');

  E.startRound(game, () => 0.5);
  const r2 = game.round;
  let count = r2.closedPile.length + r2.openRow.length + r2.hands[0].length + r2.hands[1].length;
  for (const m of r2.tableau) count += m.slots.length;
  if (count !== 54) throw new Error('a fresh round should account for all 54 cards, got ' + count);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
