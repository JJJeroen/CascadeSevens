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

check('canResolvePickup: joker filling an INTERNAL gap between two non-adjacent reals (the exact reported bug: Q _ A needing a joker as K)', () => {
  // Hand already holds JOKER + A-hearts before the pickup; Q-hearts is
  // about to be taken from the row. Q,JOKER(as K),A-hearts is a valid
  // ace-high run, but a prior version of findCandidateRuns only detected
  // a joker extending an ALREADY-ADJACENT pair by one, never a joker
  // bridging a gap between two reals that are two ranks apart -- so this
  // incorrectly reported "no legal meld possible" and warned the human
  // off a perfectly good pickup (live report, 2026-07-27).
  const hand = [
    { id: 'JOKER-1', rank: 'JOKER', suit: null },
    card('A', 'H'),
    card('3', 'C'),
    card('2', 'C'),
    card('6', 'H'),
    card('6', 'S'),
    card('10', 'D'),
  ];
  const openRow = [card('Q', 'H')];
  if (!CascadeAI.canResolvePickup(hand, openRow, 'QH')) {
    throw new Error('should find the Q,JOKER(as K),A-hearts run and report the pickup as resolvable');
  }
});

check('canResolvePickup: still correctly rejects when no meld is actually possible', () => {
  const hand = [card('3', 'C'), card('5', 'H'), card('9', 'S'), card('K', 'D')];
  const openRow = [card('7', 'C')];
  if (CascadeAI.canResolvePickup(hand, openRow, '7C')) {
    throw new Error('should NOT find any meld for a genuinely unmeldable card');
  }
});

check('canResolvePickup: a joker extends an adjacent pair downward (10-joker,J,Q), not just upward', () => {
  // A prior version only ever tried extending an adjacent pair UPWARD by
  // one rank (gapV = window[1].v + 1) -- a joker that could only complete
  // the run by extending downward was never considered. Includes a spare
  // card so the candidate meld doesn't have to consume the entire hand
  // (which layNewMeld forbids, and would make this an invalid test case
  // regardless of the run-detection logic being checked here).
  const hand = [card('J', 'D'), card('Q', 'D'), card('3', 'C')];
  const openRow = [{ id: 'JOKER-1', rank: 'JOKER', suit: null }];
  if (!CascadeAI.canResolvePickup(hand, openRow, 'JOKER-1')) {
    throw new Error('should find 10(joker),J,Q as a valid run using downward extension');
  }
});

check('AI resolves a genuinely unmeldable row obligation by discarding it back, not by stalling or throwing', () => {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.current = 1;
  game.round.comeOut[1] = true;
  // Hand has only 4C -- taking 5C from the row leaves [4C,5C], nowhere
  // near enough to form any valid run or set. Simulate having already
  // drawn it (skip straight to Part 2 with the obligation already set,
  // matching what drawFromOpenRow itself would have produced).
  game.round.hands[1] = [{ id: '4C', rank: '4', suit: 'C' }, { id: '5C', rank: '5', suit: 'C' }];
  game.round.part = 2;
  game.round.pendingObligations = ['5C'];
  game.round.rowObligationCardId = '5C';
  game.round.openRow = [{ id: 'XX', rank: '9', suit: 'D' }];
  CascadeAI.takeTurn(game, { onStateChanged: () => {} });
  if (game.round.pendingObligations.length !== 0) throw new Error('obligation should be resolved one way or another, not left dangling');
  const rowHas5C = game.round.openRow.some((c) => c.id === '5C');
  if (!rowHas5C) throw new Error('5C should have been discarded back to the open row');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
