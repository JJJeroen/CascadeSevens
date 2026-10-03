import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;
function card(rank, suit) {
  return { id: `${rank}${suit || ""}`, rank, suit: suit || null };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL: ${name} -> ${e.message}`);
  }
}

function freshGameAtPart1() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  return game;
}

check(
  "come-out does NOT carry over: under 40 can't end the turn (§2.4, 2026-10-03)",
  () => {
    const game = freshGameAtPart1();
    E.drawFromClosedPile(game);
    const hand = game.round.hands[0];
    hand.push(card("Q", "S"), card("Q", "H"), card("Q", "D")); // 30 points, below the 40 bar
    E.layNewMeld(game, [{ cardId: "QS" }, { cardId: "QH" }, { cardId: "QD" }]);
    if (game.round.comeOut[0])
      throw new Error("should not have come out at 30 points");
    if (E.comeOutShortfall(game) !== 10)
      throw new Error(
        "shortfall should be 10, got " + E.comeOutShortfall(game),
      );
    let threw = false;
    try {
      E.discard(game, hand[0].id);
    } catch (e) {
      threw = /40 points/.test(e.message);
    }
    if (!threw) throw new Error("ending the turn at 30 points must be refused");
    // a second meld in the SAME turn that brings the total to 40+ is fine
    hand.push(card("K", "S"), card("K", "H"), card("K", "D"));
    E.layNewMeld(game, [{ cardId: "KS" }, { cardId: "KH" }, { cardId: "KD" }]); // 30 + 30 = 60
    if (!game.round.comeOut[0])
      throw new Error("30 + 30 in one turn should come out");
    E.discard(game, game.round.hands[0][0].id); // now allowed
  },
);

check("comeOutAccum is tracked independently per player", () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand0 = game.round.hands[0];
  hand0.push(card("9", "S"), card("9", "H"), card("9", "D")); // 15 points, player 0
  E.layNewMeld(game, [{ cardId: "9S" }, { cardId: "9H" }, { cardId: "9D" }]);
  if (game.round.comeOutAccum[0] !== 15)
    throw new Error("player 0 accum wrong: " + game.round.comeOutAccum[0]);
  if (game.round.comeOutAccum[1] !== 0)
    throw new Error(
      "player 1 accum should be untouched: " + game.round.comeOutAccum[1],
    );
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
