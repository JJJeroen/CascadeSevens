// A rearrange commit must not change what a joker stands for in series that
// were not touched (otherwise a zero-move rearrange could turn the opponent's
// joker into the card you hold, and you could swap it out for 50 points).
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

// Player 0 (come out) to move. m1 (AI's): 5H 6H JOKER(as 7). m2 (yours): 9S 9D 9C.
function setup() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  const r = game.round;
  r.part = 2;
  r.current = 0;
  r.comeOut = [true, true];
  r.pendingObligations = [];
  r.rowObligationCardId = null;
  r.lastDraw = null;
  r.rearrange = null;
  r.tableau = [
    {
      id: "m1",
      type: "run",
      slots: [
        { card: card("5", "H"), ownerId: 1, wildAs: null },
        { card: card("6", "H"), ownerId: 1, wildAs: null },
        { card: card("JOKER"), ownerId: 1, wildAs: { rank: "7" } },
      ],
    },
    {
      id: "m2",
      type: "set",
      slots: [
        { card: card("9", "S"), ownerId: 0, wildAs: null },
        { card: card("9", "D"), ownerId: 0, wildAs: null },
        { card: card("9", "C"), ownerId: 0, wildAs: null },
      ],
    },
  ];
  r.hands[0] = [card("7", "H"), card("9", "H"), card("2", "C")];
  return game;
}
const jokerRank = (game) =>
  game.round.tableau.flatMap((m) => m.slots).find((s) => s.card.id === "JOKERJ")
    .wildAs.rank;

check("a rearrange with no moves keeps the joker where it was", () => {
  const game = setup();
  E.startRearrange(game);
  const res = E.commitRearrange(game);
  if (!res.ok) throw new Error(JSON.stringify(res.problems));
  if (jokerRank(game) !== "7")
    throw new Error(`joker now stands for ${jokerRank(game)}, expected 7`);
});

check("the opponent's joker can still be swapped for the 7 afterwards", () => {
  const game = setup();
  E.startRearrange(game);
  E.commitRearrange(game);
  const meldId = game.round.tableau.find((m) =>
    m.slots.some((s) => s.card.id === "JOKERJ"),
  ).id;
  E.swapJoker(game, meldId, "JOKERJ", "7H");
  if (!game.round.hands[0].some((c) => c.id === "JOKERJ"))
    throw new Error("the joker should now be in hand");
});

check("changing another series leaves the joker series alone", () => {
  const game = setup();
  E.startRearrange(game);
  E.rearrangeMoveCard(
    game,
    "9H",
    E.rearrangeState(game).groups.find((g) => g.cardIds.includes("9S")).groupId,
  );
  const res = E.commitRearrange(game);
  if (!res.ok) throw new Error(JSON.stringify(res.problems));
  if (jokerRank(game) !== "7") throw new Error("joker moved");
  const run = game.round.tableau.find((m) =>
    m.slots.some((s) => s.card.id === "JOKERJ"),
  );
  if (run.slots.map((s) => s.card.id).join() !== "5H,6H,JOKERJ")
    throw new Error("slot order changed: " + run.slots.map((s) => s.card.id));
  if (run.slots.some((s) => s.ownerId !== 1)) throw new Error("owner changed");
});

check("a series that WAS changed is still re-solved and validated", () => {
  const game = setup();
  E.startRearrange(game);
  const runGroup = E.rearrangeState(game).groups.find((g) =>
    g.cardIds.includes("5H"),
  ).groupId;
  E.rearrangeMoveCard(game, "7H", runGroup); // 5H 6H 7H JOKER
  const res = E.commitRearrange(game);
  if (!res.ok) throw new Error(JSON.stringify(res.problems));
  const run = game.round.tableau.find((m) =>
    m.slots.some((s) => s.card.id === "JOKERJ"),
  );
  if (run.slots.length !== 4) throw new Error("expected 4 cards");
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
