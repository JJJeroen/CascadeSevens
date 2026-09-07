// Critical-tier: pile-empty scoring (DESIGN.md §3 decision 3). The closed
// pile running out ends the round immediately -- a DIFFERENT scoring shape
// than a normal handout win: nobody gets the +50 bonus, and BOTH players are
// penalized for their own remaining hand, not just a "loser." Confirmed by
// grep before writing this file: zero references to endRoundPileEmpty or
// this scoring path existed anywhere in the test suite.
global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit || ''}`, rank, suit: suit || null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart1() {
  const game = E.newGame('standard', () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game); // lands on part === 1, current === 0
  return game;
}

check('pile-empty: both players penalized for their own hand, neither gets the winner bonus', () => {
  const game = freshGameAtPart1();
  const r = game.round;
  r.closedPile = [];
  r.hands[0] = [card('2', 'C')]; // 5 pt penalty
  r.hands[1] = [card('9', 'D'), card('9', 'S')]; // 5+5 = 10 pt penalty

  E.drawFromClosedPile(game); // pile is empty -> ends the round right here

  if (!r.ended || r.endReason !== 'pile-empty') throw new Error('round should end via pile-empty');
  if (r.roundWinner !== null) throw new Error('pile-empty has no winner, got ' + r.roundWinner);
  if (r.roundScores[0] !== -5) throw new Error('player 0 should be penalized exactly -5, got ' + r.roundScores[0]);
  if (r.roundScores[1] !== -10) throw new Error('player 1 should be penalized exactly -10, got ' + r.roundScores[1]);
});

check('pile-empty: meld points already on the table still count for their owner, alongside the penalty', () => {
  const game = freshGameAtPart1();
  const r = game.round;
  r.closedPile = [];
  r.tableau.push({ id: 'm1', type: 'run', slots: [
    { card: card('5', 'H'), ownerId: 0, wildAs: null },
    { card: card('6', 'H'), ownerId: 0, wildAs: null },
    { card: card('7', 'H'), ownerId: 0, wildAs: null },
  ] }); // 15 pts to player 0
  r.hands[0] = [card('2', 'C')]; // 5 pt penalty
  r.hands[1] = [card('9', 'D')]; // 5 pt penalty

  E.drawFromClosedPile(game);

  if (r.roundScores[0] !== 10) throw new Error('player 0: 15 melds - 5 penalty = 10, got ' + r.roundScores[0]);
  if (r.roundScores[1] !== -5) throw new Error('player 1: 0 melds - 5 penalty = -5, got ' + r.roundScores[1]);
});

check('pile-empty is reachable only via a draw attempt on an empty closed pile, not any other way', () => {
  const game = freshGameAtPart1();
  const r = game.round;
  r.closedPile = [card('3', 'S')]; // NOT empty
  r.hands[0] = [card('2', 'C')];
  r.hands[1] = [card('9', 'D')];
  E.drawFromClosedPile(game);
  if (r.ended) throw new Error('drawing a real card must not end the round');
  if (r.hands[0].length !== 2) throw new Error('the drawn card should have been added to hand');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
