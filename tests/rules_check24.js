// §2.4 (revised 2026-10-03): the 40 points to come out must be laid within a
// single turn, and a player who has laid under 40 can't end their turn until
// they lay more or take those melds back. Covers the take-back mechanics.
import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;
const card = (rank, suit) => ({
  id: `${rank}${suit || ""}`,
  rank,
  suit: suit || null,
});

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
const lay = (game, ...cards) =>
  E.layNewMeld(
    game,
    cards.map((c) => ({ cardId: c.id })),
  );

check(
  "take back returns the melds' cards to the hand and clears the shortfall",
  () => {
    const game = freshGameAtPart1();
    E.drawFromClosedPile(game);
    const hand = game.round.hands[0];
    const n = hand.length;
    const q = [card("Q", "S"), card("Q", "H"), card("Q", "D")];
    hand.push(...q);
    lay(game, ...q);
    if (game.round.tableau.length !== 1)
      throw new Error("setup: meld not laid");
    E.takeBackUnqualifiedMelds(game);
    if (game.round.tableau.length !== 0)
      throw new Error("meld should be off the table");
    if (hand.length !== n + 3)
      throw new Error(`hand should have ${n + 3} cards, has ${hand.length}`);
    if (E.comeOutShortfall(game) !== 0)
      throw new Error("shortfall should be 0 after take-back");
    if (game.round.comeOutAccum[0] !== 0)
      throw new Error("accum should reset to 0");
    E.discard(game, hand[0].id); // ending the turn is allowed again
  },
);

check("take back removes only THIS turn's melds (all of them)", () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const hand = game.round.hands[0];
  const a = [card("5", "S"), card("5", "H"), card("5", "D")]; // 15
  const b = [card("7", "S"), card("7", "H"), card("7", "D")]; // 15 -> 30 total
  hand.push(...a, ...b);
  lay(game, ...a);
  lay(game, ...b);
  if (E.comeOutShortfall(game) !== 10) throw new Error("expected shortfall 10");
  E.takeBackUnqualifiedMelds(game);
  if (game.round.tableau.length !== 0)
    throw new Error("both melds should be taken back");
  for (const c of [...a, ...b])
    if (!hand.some((h) => h.id === c.id))
      throw new Error(`${c.id} not back in hand`);
});

check("take back restores the open-row obligation and pickup undo", () => {
  const game = freshGameAtPart1();
  // put a known card on the row, give the player a pair that completes a set with it
  game.round.openRow = [card("9", "C")];
  game.round.hands[0] = [
    card("9", "S"),
    card("9", "H"),
    card("2", "D"),
    card("3", "C"),
    card("4", "H"),
    card("6", "S"),
    card("8", "D"),
  ];
  E.drawFromOpenRow(game, "9C");
  E.finishDrawing(game);
  if (!game.round.pendingObligations.includes("9C"))
    throw new Error("setup: 9C should be owed");
  lay(game, card("9", "S"), card("9", "H"), card("9", "C")); // 15 < 40; clears the obligation
  if (game.round.pendingObligations.length !== 0)
    throw new Error("setup: obligation should be cleared by the meld");
  E.takeBackUnqualifiedMelds(game);
  if (!game.round.pendingObligations.includes("9C"))
    throw new Error(
      "the row card obligation must be restored by the take-back",
    );
  if (game.round.rowObligationCardId !== "9C")
    throw new Error("rowObligationCardId not restored");
  if (!E.canUndoDraw(game))
    throw new Error("pickup undo should be available again");
  E.discard(game, "9C"); // the owed card may go straight back to the row
});

check("take back is refused once you've come out, or with nothing laid", () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  let threw = false;
  try {
    E.takeBackUnqualifiedMelds(game);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("nothing laid: take-back should be refused");
  const hand = game.round.hands[0];
  const k = [card("K", "S"), card("K", "H"), card("K", "D")];
  const q = [card("Q", "S"), card("Q", "H"), card("Q", "D")];
  hand.push(...k, ...q);
  lay(game, ...k);
  lay(game, ...q); // 60 -> out
  if (!game.round.comeOut[0]) throw new Error("setup: should be out");
  threw = false;
  try {
    E.takeBackUnqualifiedMelds(game);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("take-back after coming out should be refused");
});

check("the shortfall resets between turns and per player", () => {
  const game = freshGameAtPart1();
  E.drawFromClosedPile(game);
  const q = [card("Q", "S"), card("Q", "H"), card("Q", "D")];
  game.round.hands[0].push(...q);
  lay(game, ...q);
  E.takeBackUnqualifiedMelds(game);
  E.discard(game, game.round.hands[0][0].id);
  if (E.comeOutShortfall(game) !== 0) throw new Error("player 1 starts clean");
  E.drawFromClosedPile(game);
  E.discard(game, game.round.hands[1][0].id);
  if (game.round.current !== 0 || E.comeOutShortfall(game) !== 0)
    throw new Error("player 0's next turn starts clean (no carry-over)");
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
