// Round-end and robustness fixes from the full code review (2026-10-05):
// - an empty closed pile ends the round when the player who drew the last
//   card has finished their turn (DESIGN decision 3)
// - nothing can be taken from the cascade once the round has ended
// - seeds: any finite number is valid (negative/huge), and seeds that differ
//   by the old 233,280 period no longer give the same deal
// - turn0Accept validates its input before changing anything
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

function atPart1() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  game.round.current = 0;
  return game;
}

check("drawing the last pile card does not end the round by itself", () => {
  const game = atPart1();
  const r = game.round;
  r.closedPile = [card("3", "S")];
  r.hands[0] = [card("2", "C"), card("5", "D")];
  r.hands[1] = [card("9", "D"), card("9", "H")];
  E.drawFromClosedPile(game);
  if (r.ended) throw new Error("ended too early");
  if (r.part !== 2) throw new Error("the drawer should get to finish the turn");
});

check("the round ends once the player who drew the last card discards", () => {
  const game = atPart1();
  const r = game.round;
  r.closedPile = [card("3", "S")];
  r.hands[0] = [card("2", "C"), card("5", "D")];
  r.hands[1] = [card("9", "D"), card("9", "H")];
  E.drawFromClosedPile(game);
  E.discard(game, "2C");
  if (!r.ended || r.endReason !== "pile-empty")
    throw new Error("round should have ended: pile-empty");
  if (r.roundWinner !== null) throw new Error("pile-empty has no winner");
});

check("going out with the last pile card is still a normal hand-out", () => {
  const game = atPart1();
  const r = game.round;
  r.closedPile = [card("3", "S")];
  r.comeOut = [true, true];
  r.tableau = [
    {
      id: "m1",
      type: "set",
      slots: [
        { card: card("8", "S"), ownerId: 0, wildAs: null },
        { card: card("8", "H"), ownerId: 0, wildAs: null },
        { card: card("8", "D"), ownerId: 0, wildAs: null },
      ],
    },
  ];
  r.hands[0] = [card("3", "D")];
  r.hands[1] = [card("9", "D"), card("9", "H")];
  E.drawFromClosedPile(game);
  E.discard(game, "3S");
  E.discard(game, "3D");
  if (r.endReason !== "handout")
    throw new Error("expected handout, got " + r.endReason);
});

check("no cascade take after the round has ended", () => {
  const game = atPart1();
  const r = game.round;
  r.closedPile = [card("3", "S")];
  r.hands[0] = [card("2", "C"), card("5", "D")];
  r.hands[1] = [card("9", "D"), card("9", "H")];
  E.drawFromOpenRow(game, r.openRow[0].id); // take, so Part 2 takes are open
  r.closedPile = [];
  r.ended = true;
  r.endReason = "handout";
  if (E.canDrawFromRow(game)) throw new Error("canDrawFromRow should be false");
  if (!throws(() => E.drawFromOpenRow(game, r.openRow[0]?.id ?? "x")))
    throw new Error("drawFromOpenRow should throw");
  if (E.canDrawFromClosedPile(game))
    throw new Error("pile should be closed too");
});

const dealIds = (seed) => {
  const rng = E.seededRng(seed);
  const game = E.newGame("standard", rng);
  E.startRound(game, rng);
  const r = game.round;
  return [...r.hands[0], ...r.hands[1], ...r.openRow, ...r.closedPile].map(
    (c) => c && c.id,
  );
};

check(
  "negative, huge and fractional seeds still deal all 54 distinct cards",
  () => {
    for (const seed of [-123456, -1, 0, 1e12, -1e12, 3.7, 233280, -233280]) {
      const ids = dealIds(seed);
      if (
        ids.length !== 54 ||
        ids.some((id) => !id) ||
        new Set(ids).size !== 54
      )
        throw new Error(`seed ${seed} dealt a broken deck`);
    }
  },
);

check("seeds 233,280 apart no longer give the same deal", () => {
  if (dealIds(7).join() === dealIds(7 + 233280).join())
    throw new Error("same deal");
});

check("the same seed still reproduces the same deal", () => {
  if (dealIds(-42).join() !== dealIds(-42).join()) throw new Error("differs");
});

check("turn0Accept with an unknown card id changes nothing", () => {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  const r = game.round;
  const asker = E.turn0CurrentAskee(game);
  const before = JSON.stringify([r.hands, r.openRow, r.turn0]);
  if (!throws(() => E.turn0Accept(game, "NOPE")))
    throw new Error("should throw");
  if (JSON.stringify([r.hands, r.openRow, r.turn0]) !== before)
    throw new Error("state changed although the call threw");
  if (E.turn0CurrentAskee(game) !== asker) throw new Error("askee changed");
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
