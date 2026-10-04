// Take, lay, take again (DESIGN.md decision 24, requested by Tommer): once a
// player has taken from the cascade this turn they may take again after laying
// series. The pile stays locked; the newest take's bottom card is the owed
// card; every take can be undone; taking back under-40 series also returns
// the takes made after the first series.
import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;
const card = (rank, suit) => ({
  id: `${rank}${suit || "J"}`,
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
const throws = (fn) => {
  try {
    fn();
  } catch {
    return true;
  }
  return false;
};
const ids = (cards) => cards.map((c) => c.id);
const sel = (...cardIds) => cardIds.map((cardId) => ({ cardId }));

// Player 0 to move, not come out, cascade 2S 3S 4S 5S 9H KD, hand 7C 7D 7H 2C.
function setup() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  const r = game.round;
  r.current = 0;
  r.openRow = [
    card("2", "S"),
    card("3", "S"),
    card("4", "S"),
    card("5", "S"),
    card("9", "H"),
    card("K", "D"),
  ];
  r.hands[0] = [card("7", "C"), card("7", "D"), card("7", "H"), card("2", "C")];
  return game;
}

check("a second take after laying a series is allowed", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "9H"); // takes 9H, KD
  E.layNewMeld(game, sel("7C", "7D", "7H"));
  if (!E.canDrawFromRow(game)) throw new Error("should be able to take again");
  E.drawFromOpenRow(game, "4S"); // takes 4S, 5S
  if (!ids(r.hands[0]).includes("5S")) throw new Error("5S not in hand");
  if (r.part !== 2) throw new Error("should stay in Part 2");
});

check("the closed pile stays locked", () => {
  const game = setup();
  E.drawFromOpenRow(game, "KD");
  E.layNewMeld(game, sel("7C", "7D", "7H"));
  if (E.canDrawFromClosedPile(game)) throw new Error("pile should be locked");
  if (!throws(() => E.drawFromClosedPile(game)))
    throw new Error("drawing from the pile should throw");
});

check("no second take after a pile draw (pile -> lay -> cascade)", () => {
  const game = setup();
  E.drawFromClosedPile(game);
  if (E.canDrawFromRow(game)) throw new Error("should not be allowed");
  if (!throws(() => E.drawFromOpenRow(game, "KD")))
    throw new Error("should throw");
});

check("the newest take's bottom card becomes the owed card", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "9H");
  E.layNewMeld(game, sel("7C", "7D", "7H"));
  E.drawFromOpenRow(game, "4S");
  if (JSON.stringify(r.pendingObligations) !== '["4S"]')
    throw new Error(JSON.stringify(r.pendingObligations));
  if (r.rowObligationCardId !== "4S") throw new Error("wrong row obligation");
});

check("a joker-swap obligation survives a later take", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "KD");
  r.comeOut[0] = true;
  r.pendingObligations = ["JOKERJ", "KD"]; // owed joker + the take's card
  r.hands[0].push(card("JOKER"));
  E.drawFromOpenRow(game, "5S"); // the row is 2S 3S 4S 5S 9H after KD left
  if (!r.pendingObligations.includes("JOKERJ"))
    throw new Error("the joker obligation was dropped");
  if (r.pendingObligations.includes("KD"))
    throw new Error("the old take's obligation should be superseded");
});

check("the second take can be undone, then the first", () => {
  const game = setup();
  const r = game.round;
  const rowBefore = ids(r.openRow);
  E.drawFromOpenRow(game, "9H");
  E.drawFromOpenRow(game, "4S"); // two takes, no series in between
  E.undoDraw(game);
  if (ids(r.openRow).join() !== "2S,3S,4S,5S")
    throw new Error("row after undo 2");
  if (JSON.stringify(r.pendingObligations) !== '["9H"]')
    throw new Error("obligation not restored");
  if (!E.canUndoDraw(game))
    throw new Error("first take should still be undoable");
  E.undoDraw(game);
  if (ids(r.openRow).join() !== rowBefore.join())
    throw new Error("row after undo 1");
  if (r.part !== 1 || !E.canDrawFromClosedPile(game))
    throw new Error("should be back at the start of the draw");
});

check(
  "a take after laying can be undone (back in Part 2, earlier obligation restored)",
  () => {
    const game = setup();
    const r = game.round;
    E.drawFromOpenRow(game, "9H");
    E.layNewMeld(game, sel("7C", "7D", "7H"));
    E.drawFromOpenRow(game, "4S");
    E.undoDraw(game);
    if (ids(r.openRow).join() !== "2S,3S,4S,5S")
      throw new Error("row not restored");
    if (r.part !== 2) throw new Error("should still be in Part 2");
    if (r.rowDrawsThisPart1 !== 1) throw new Error("take counter wrong");
    if (JSON.stringify(r.pendingObligations) !== '["9H"]')
      throw new Error(
        "the first take's obligation should be back: " +
          JSON.stringify(r.pendingObligations),
      );
  },
);

check("taking back under-40 series also returns takes made after them", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "9H"); // 9H KD
  const handAfterTake1 = ids(r.hands[0]).sort().join();
  const rowAfterTake1 = ids(r.openRow).join();
  E.layNewMeld(game, sel("7C", "7D", "7H")); // 21 points, under 40
  E.drawFromOpenRow(game, "4S"); // 4S 5S
  E.takeBackUnqualifiedMelds(game);
  if (ids(r.hands[0]).sort().join() !== handAfterTake1)
    throw new Error(
      "hand differs from just after the first take: " + ids(r.hands[0]),
    );
  if (ids(r.openRow).join() !== rowAfterTake1)
    throw new Error("cascade differs: " + ids(r.openRow));
  if (JSON.stringify(r.pendingObligations) !== '["9H"]')
    throw new Error("obligation not restored");
  if (!E.canUndoDraw(game))
    throw new Error("first take should be undoable again");
  E.undoDraw(game);
  if (ids(r.openRow).join() !== "2S,3S,4S,5S,9H,KD")
    throw new Error("full undo failed");
});

check("undoing a later take drops it from the take-back snapshot", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "9H");
  E.layNewMeld(game, sel("7C", "7D", "7H"));
  E.drawFromOpenRow(game, "4S");
  E.undoDraw(game);
  E.takeBackUnqualifiedMelds(game); // must not return 4S/5S a second time
  if (ids(r.openRow).join() !== "2S,3S,4S,5S") throw new Error(ids(r.openRow));
  if (ids(r.hands[0]).length !== 6)
    throw new Error("hand size " + ids(r.hands[0]));
});

check("cards are conserved across take / lay / take / take back", () => {
  const game = setup();
  const r = game.round;
  const total = () =>
    r.hands[0].length +
    r.openRow.length +
    r.tableau.reduce((n, m) => n + m.slots.length, 0);
  const before = total();
  E.drawFromOpenRow(game, "9H");
  E.layNewMeld(game, sel("7C", "7D", "7H"));
  E.drawFromOpenRow(game, "4S");
  if (total() !== before) throw new Error("lost cards mid-turn");
  E.takeBackUnqualifiedMelds(game);
  if (total() !== before) throw new Error("lost cards after take back");
});

check("no take in Part 2 while a rearrange session is open", () => {
  const game = setup();
  const r = game.round;
  E.drawFromOpenRow(game, "KD");
  r.comeOut[0] = true;
  r.rearrange = {
    cardById: {},
    originalOwnerByCardId: {},
    groups: {},
    handPool: [],
    nextGroupId: 0,
  };
  if (E.canDrawFromRow(game)) throw new Error("should be blocked");
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
