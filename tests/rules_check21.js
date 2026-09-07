// Medium-tier: the game-over boundary. Confirmed by reading both files:
// game.gameOver is set in engine.js (checkGameEnd) but never CONSULTED by
// engine.js itself anywhere -- app.js is entirely responsible for stopping
// further play once it's true (it guards rendering and turn-taking at
// several points). This is a deliberate architecture choice (a pure, dumb
// state machine shouldn't also own application-level flow control), not a
// bug -- but it's exactly the kind of implicit contract that should be
// pinned down by a test, not left to be discovered by accident if it ever
// silently changes. If this ever becomes an intentional engine-level guard
// instead, THIS test is the one that should need updating.
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

check('the engine itself does not block further actions once gameOver is true -- that guard lives in app.js', () => {
  const game = freshGameAtPart2();
  game.scores = [951, 700];
  game.round.hands[0] = [card('2', 'C')];
  game.round.hands[1] = [card('2', 'H')];
  E.discard(game, '2C'); // crosses the threshold, ends the game

  if (!game.gameOver || game.winner !== 0) throw new Error('test setup: game should be over with player 0 winning');

  let threw = false;
  try { E.startRound(game, () => 0.5); } catch (e) { threw = true; }
  if (threw) {
    throw new Error(
      'startRound unexpectedly began throwing after gameOver -- if this is an intentional new engine-level guard, update this test to assert the throw instead of treating it as a failure'
    );
  }
  if (game.roundNumber !== 2) throw new Error('documenting current behavior: a new round actually starts even though gameOver is true');
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
