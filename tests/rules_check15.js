// Critical-tier: round-win scoring (DESIGN.md §2.7/§2.8). Playing your last
// card as the mandatory Part 3 discard ends the round -- the discarding
// player wins. This file asserts the actual scoring arithmetic that follows
// (winner +50 bonus, per-card meld points by OWNER not by meld, loser's hand
// penalty), which nothing in the existing suite verified: the simulations
// reach this path constantly but only ever check for stalls and card
// conservation, never that the declared winner or score is correct.
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
  const game = E.newGame('standard', () => 0.1); // starter/current = player 0
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.part = 2;
  return game;
}

check('round win via hand-empty discard: winner gets +50 bonus and own meld points, no hand penalty', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.tableau.push({ id: 'm1', type: 'run', slots: [
    { card: card('5', 'H'), ownerId: 0, wildAs: null },
    { card: card('6', 'H'), ownerId: 0, wildAs: null },
    { card: card('7', 'H'), ownerId: 0, wildAs: null },
  ] }); // 5+5+5 = 15 pts, all owned by player 0
  r.tableau.push({ id: 'm2', type: 'set', slots: [
    { card: card('K', 'H'), ownerId: 1, wildAs: null },
    { card: card('K', 'D'), ownerId: 1, wildAs: null },
    { card: card('K', 'C'), ownerId: 1, wildAs: null },
  ] }); // 10+10+10 = 30 pts, all owned by player 1
  r.hands[0] = [card('2', 'C')]; // player 0's last card
  r.hands[1] = [card('9', 'D'), card('J', 'C')]; // 5 + 10 = 15 pt penalty for player 1
  E.discard(game, '2C');

  if (!r.ended || r.endReason !== 'handout') throw new Error('round should end via handout');
  if (r.roundWinner !== 0) throw new Error('player 0 should be the winner, got ' + r.roundWinner);
  if (r.roundScores[0] !== 65) throw new Error('winner score should be 50 bonus + 15 melds = 65, got ' + r.roundScores[0]);
  if (r.roundScores[1] !== 15) throw new Error('loser score should be 30 melds - 15 penalty = 15, got ' + r.roundScores[1]);
  if (game.scores[0] !== 65 || game.scores[1] !== 15) {
    throw new Error(`game.scores should reflect exactly this round on a fresh game, got [${game.scores}]`);
  }
});

check('round win: a mixed-ownership meld attributes points per slot owner, not per meld', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.tableau.push({ id: 'm1', type: 'set', slots: [
    { card: card('9', 'H'), ownerId: 0, wildAs: null }, // 5 pts to player 0
    { card: card('9', 'D'), ownerId: 1, wildAs: null }, // 5 pts to player 1
    { card: card('9', 'C'), ownerId: 0, wildAs: null }, // 5 pts to player 0
  ] });
  r.hands[0] = [card('2', 'C')];
  r.hands[1] = [card('4', 'S')]; // 5 pt penalty

  E.discard(game, '2C');

  if (r.roundScores[0] !== 60) throw new Error('player 0 should get bonus(50) + their 2 slots (10) = 60, got ' + r.roundScores[0]);
  if (r.roundScores[1] !== 0) throw new Error('player 1 should get their 1 slot (5) - hand penalty (5) = 0, got ' + r.roundScores[1]);
});

check('round win: a winner with zero melds still gets exactly the +50 bonus, nothing more', () => {
  const game = freshGameAtPart2();
  const r = game.round;
  r.hands[0] = [card('7', 'D')];
  r.hands[1] = [card('K', 'S'), card('K', 'H'), card('A', 'C')]; // 10+10+25 = 45 pt penalty
  E.discard(game, '7D');
  if (r.roundScores[0] !== 50) throw new Error('winner with no melds should score exactly 50, got ' + r.roundScores[0]);
  if (r.roundScores[1] !== -45) throw new Error('loser should be penalized their full hand value, got ' + r.roundScores[1]);
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
