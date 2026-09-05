// Critical-tier: game-end threshold boundaries (DESIGN.md §2.9). The game
// ends at the end of whichever round is the FIRST in which one player has
// MORE THAN the threshold (strictly greater, not equal) AND strictly more
// points than the other. Both halves of that condition have specific edge
// cases that silently do nothing wrong (no crash, no stall) if implemented
// off-by-one -- which is exactly why the existing simulations never caught
// anything here: they only ever check for stalls and card conservation,
// never whether checkGameEnd's own boundary logic is correct.
global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit || ''}`, rank, suit: suit || null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

function freshGameAtPart2(mode) {
  const game = E.newGame(mode || 'standard', () => 0.1); // starter/current = player 0
  E.startRound(game, () => 0.5);
  E.turn0Decline(game); E.turn0Decline(game);
  game.round.part = 2;
  return game;
}

// Ends the round via the current player discarding their last card (a clean
// handout win): winner gets +50 and nothing else; loser is penalized their
// one remaining card's point value. A small, fully predictable delta to
// layer on top of whatever game.scores was set to beforehand.
function endHandoutRound(game, winnerCard, loserCard) {
  const r = game.round;
  r.hands[r.current] = [winnerCard];
  r.hands[E.other(r.current)] = [loserCard];
  E.discard(game, winnerCard.id);
}

// Ends the round via an empty closed pile: no bonus, both players penalized
// for their own hand -- a symmetric, small, predictable delta for both.
function endPileEmptyRound(game, handA, handB) {
  const r = game.round;
  r.part = 1;
  r.rowDrawsThisPart1 = 0;
  r.closedPile = [];
  r.hands[0] = handA;
  r.hands[1] = handB;
  E.drawFromClosedPile(game);
}

check('exactly at the threshold (=1000) does not end the game -- must be STRICTLY greater', () => {
  const game = freshGameAtPart2();
  game.scores = [950, 700];
  endHandoutRound(game, card('2', 'C'), card('2', 'H')); // winner +50, loser -5
  if (game.scores[0] !== 1000) throw new Error('expected winner score 1000, got ' + game.scores[0]);
  if (game.gameOver) throw new Error('game must not end at exactly the threshold');
});

check('crossing strictly above the threshold while ahead ends the game', () => {
  const game = freshGameAtPart2();
  game.scores = [951, 700];
  endHandoutRound(game, card('2', 'C'), card('2', 'H'));
  if (game.scores[0] !== 1001) throw new Error('expected 1001, got ' + game.scores[0]);
  if (!game.gameOver || game.winner !== 0) throw new Error('game should end with player 0 winning once strictly over threshold and ahead');
});

check('both players over the threshold but tied does not end the game', () => {
  const game = freshGameAtPart2();
  game.scores = [1055, 1055];
  endPileEmptyRound(game, [card('2', 'C')], [card('2', 'H')]); // -5 / -5, stays tied
  if (game.scores[0] !== 1050 || game.scores[1] !== 1050) {
    throw new Error(`expected both at 1050, got [${game.scores}]`);
  }
  if (game.gameOver) throw new Error('a tie above the threshold must not end the game -- neither player is STRICTLY ahead');
});

check('being ahead while still under the threshold does not end the game', () => {
  const game = freshGameAtPart2();
  game.scores = [900, 500];
  endPileEmptyRound(game, [card('2', 'C')], [card('2', 'H')]); // -5 / -5
  if (game.scores[0] !== 895 || game.scores[1] !== 495) {
    throw new Error(`expected 895/495, got [${game.scores}]`);
  }
  if (game.gameOver) throw new Error('being ahead is not enough without also crossing the threshold');
});

check('quick mode ends the game at its own 300 threshold, not 1000', () => {
  const game = freshGameAtPart2('quick');
  if (game.threshold !== 300) throw new Error('quick mode should set threshold=300, got ' + game.threshold);
  game.scores = [296, 100];
  endHandoutRound(game, card('2', 'C'), card('2', 'H'));
  if (game.scores[0] !== 346) throw new Error('expected 346, got ' + game.scores[0]);
  if (!game.gameOver || game.winner !== 0) throw new Error('quick mode should end once strictly over its own 300 threshold and ahead');
});

check('quick mode: exactly at 300 does not end the game', () => {
  const game = freshGameAtPart2('quick');
  game.scores = [250, 100];
  endHandoutRound(game, card('2', 'C'), card('2', 'H')); // +50 -> exactly 300
  if (game.scores[0] !== 300) throw new Error('expected exactly 300, got ' + game.scores[0]);
  if (game.gameOver) throw new Error('quick mode must not end at exactly its own threshold either');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
