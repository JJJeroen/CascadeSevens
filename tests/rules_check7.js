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

check('AI prefers swapping a joker over just adding, when replay is safe', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.current = 1;
  game.round.part = 2;
  game.round.comeOut[1] = true;
  game.round.tableau.push({ id: 'm-set', type: 'set', slots: [
    { card: card('7','S'), ownerId: 1, wildAs: null },
    { card: card('7','H'), ownerId: 1, wildAs: null },
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
  ]});
  // JD+QD let the freed joker replay as the K in a J-Q-K run afterward, and
  // 2S is a spare so that replay doesn't itself consume the whole hand.
  // None of these four cards form any OTHER candidate meld on their own, so
  // the AI reaches the swap-or-add decision for 7C instead of doing
  // something unrelated first.
  game.round.hands[1] = [card('7','C'), card('J','D'), card('Q','D'), card('2','S')];
  CascadeAI.takeTurn(game, { onStateChanged: () => {} });
  const meld = game.round.tableau.find(m => m.id === 'm-set');
  const has7C = meld.slots.some(s => s.card.id === '7C');
  const jokerStillThere = meld.slots.some(s => s.card.rank === 'JOKER');
  if (!has7C) throw new Error('7C was never placed at all');
  if (jokerStillThere) throw new Error('AI added 7C alongside the joker instead of swapping it out');
});

check('AI falls back to a plain add when the joker would not be safely replayable', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.current = 1;
  game.round.part = 2;
  game.round.comeOut[1] = true;
  game.round.tableau.push({ id: 'm-set', type: 'set', slots: [
    { card: card('7','S'), ownerId: 1, wildAs: null },
    { card: card('7','H'), ownerId: 1, wildAs: null },
    { card: { id: 'JOKER-1', rank: 'JOKER', suit: null }, ownerId: 1, wildAs: { rank: '7' } },
  ]});
  // Only 7C in hand -- swapping would leave nothing to replay the joker
  // with, so adding 7C directly (leaving the joker in place) is correct.
  game.round.hands[1] = [card('7','C'), card('2','H')];
  CascadeAI.takeTurn(game, { onStateChanged: () => {} });
  const meld = game.round.tableau.find(m => m.id === 'm-set');
  const has7C = meld.slots.some(s => s.card.id === '7C');
  const jokerStillThere = meld.slots.some(s => s.card.rank === 'JOKER');
  if (!has7C) throw new Error('7C was never placed at all');
  if (!jokerStillThere) throw new Error('AI swapped the joker out even though it could not have safely replayed it');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
