// Joker swap credit (DESIGN.md 2.8, decision 23): the replacement card keeps the
// owner of the joker's slot. Swapping a joker out of the OPPONENT's series
// leaves your card credited to the opponent; the joker is yours to play again.
// Swapping out your own joker keeps the card yours.
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

// Player 0 (has come out) to move; a 7-7-Joker set on the table owned by `jokerOwner`.
function setup(jokerOwner) {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  const r = game.round;
  r.part = 2;
  r.current = 0;
  r.comeOut[0] = true;
  r.comeOut[1] = true;
  r.pendingObligations = [];
  r.rowObligationCardId = null;
  r.lastDraw = null;
  r.rearrange = null;
  game.scores = [0, 0];
  r.tableau = [
    {
      id: "m1",
      type: "set",
      slots: [
        { card: card("7", "S"), ownerId: jokerOwner, wildAs: null },
        { card: card("7", "H"), ownerId: jokerOwner, wildAs: null },
        { card: card("JOKER"), ownerId: jokerOwner, wildAs: { rank: "7" } },
      ],
    },
  ];
  r.hands[0] = [
    card("7", "D"),
    card("Q", "S"),
    card("Q", "H"),
    card("3", "C"),
    card("9", "D"),
  ];
  return game;
}
const slotOf = (game, id) =>
  game.round.tableau.flatMap((m) => m.slots).find((s) => s.card.id === id);

check(
  "swapping the OPPONENT's joker: the replacement stays credited to the opponent",
  () => {
    const game = setup(1);
    E.swapJoker(game, "m1", "JOKERJ", "7D");
    if (slotOf(game, "7D").ownerId !== 1)
      throw new Error(
        "7D should be credited to the opponent (1), got " +
          slotOf(game, "7D").ownerId,
      );
    if (!game.round.hands[0].some((c) => c.id === "JOKERJ"))
      throw new Error("the joker should be in the swapper's hand");
  },
);

check(
  "score swing: the opponent keeps the replacement's 5, the swapper scores the joker once it is played",
  () => {
    const game = setup(1);
    if (E.liveScore(game, 1) !== 60)
      throw new Error("setup: opponent should have 5+5+50 = 60");
    E.swapJoker(game, "m1", "JOKERJ", "7D");
    if (E.liveScore(game, 1) !== 15)
      throw new Error(
        "opponent should keep 5+5+5 = 15 after the swap, has " +
          E.liveScore(game, 1),
      );
    if (E.liveScore(game, 0) !== 0)
      throw new Error(
        "the swapper scores nothing until the joker is played, has " +
          E.liveScore(game, 0),
      );
    E.layNewMeld(game, [
      { cardId: "QS" },
      { cardId: "QH" },
      { cardId: "JOKERJ", wildAs: { rank: "Q" } },
    ]);
    if (E.liveScore(game, 0) !== 70)
      throw new Error(
        "Q+Q+Joker should score 10+10+50 = 70 for the swapper, got " +
          E.liveScore(game, 0),
      );
  },
);

check(
  "the swapper cannot pull the replacement back (it is credited to the opponent)",
  () => {
    const game = setup(1);
    E.swapJoker(game, "m1", "JOKERJ", "7D");
    let threw = false;
    try {
      E.pullFromMeld(game, "m1", "7D");
    } catch (e) {
      threw = /credited to the other player/.test(e.message);
    }
    if (!threw)
      throw new Error(
        "pulling a card credited to the opponent must be refused",
      );
  },
);

check("swapping out your OWN joker keeps the replacement yours", () => {
  const game = setup(0);
  E.swapJoker(game, "m1", "JOKERJ", "7D");
  if (slotOf(game, "7D").ownerId !== 0)
    throw new Error(
      "7D should stay yours (0), got " + slotOf(game, "7D").ownerId,
    );
});

check("the log says whose series it was and where the card stays", () => {
  const game = setup(1);
  E.swapJoker(game, "m1", "JOKERJ", "7D");
  const line = game.round.log.at(-1);
  if (
    !/out of Player 2's series/.test(line) ||
    !/stays with Player 2/.test(line)
  )
    throw new Error("unexpected log line: " + line);
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
