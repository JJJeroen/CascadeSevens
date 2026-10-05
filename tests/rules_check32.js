// "Start turn over" (DESIGN decision 25): an owed cascade card cannot be
// discarded, so a player who laid other series and then cannot place it must
// be able to put the whole turn back and draw again.
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
const sel = (...ids) => ids.map((cardId) => ({ cardId }));

// Player 0 to move; cascade 5C; hand has an unrelated set (KS KH KD) + spares.
function setup({ comeOut = true } = {}) {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  const r = game.round;
  r.current = 0;
  r.comeOut = [comeOut, false];
  r.openRow = [card("5", "C")];
  r.hands[0] = [
    card("K", "S"),
    card("K", "H"),
    card("K", "D"),
    card("2", "C"),
    card("9", "D"),
  ];
  return game;
}
const snap = (game) =>
  JSON.stringify({
    hand: game.round.hands[0],
    row: game.round.openRow,
    tableau: game.round.tableau,
    pile: game.round.closedPile.length,
  });

check("stuck after laying another series: restart puts everything back", () => {
  const game = setup();
  const r = game.round;
  const before = snap(game);
  E.drawFromOpenRow(game, "5C"); // owed, nothing to lay it with
  E.layNewMeld(game, sel("KS", "KH", "KD")); // closes the undo window
  if (E.canUndoDraw(game)) throw new Error("setup: undo should be closed");
  if (!throws(() => E.discard(game, "2C")))
    throw new Error("setup: the owed card should block the discard");
  if (!E.canRestartTurn(game)) throw new Error("restart should be possible");
  E.restartTurn(game);
  if (snap(game) !== before)
    throw new Error("state differs from before the take");
  if (r.part !== 1) throw new Error("should be back in Part 1");
  if (r.pendingObligations.length !== 0) throw new Error("still owed");
  if (!E.canDrawFromClosedPile(game))
    throw new Error("the pile should be open again");
});

check(
  "after restarting the player can draw from the pile and finish the turn",
  () => {
    const game = setup();
    E.drawFromOpenRow(game, "5C");
    E.layNewMeld(game, sel("KS", "KH", "KD"));
    E.restartTurn(game);
    E.drawFromClosedPile(game);
    E.discard(game, "2C");
    if (game.round.current !== 1) throw new Error("the turn should have ended");
  },
);

check("restart also works after several takes", () => {
  const game = setup();
  const r = game.round;
  r.openRow = [card("3", "C"), card("5", "C"), card("8", "H")];
  const before = snap(game);
  E.drawFromOpenRow(game, "8H");
  E.layNewMeld(game, sel("KS", "KH", "KD"));
  E.drawFromOpenRow(game, "5C");
  E.restartTurn(game);
  if (snap(game) !== before)
    throw new Error("not restored to before the first take");
});

check("restart undoes come-out progress", () => {
  const game = setup({ comeOut: false });
  const r = game.round;
  r.hands[0] = [
    card("A", "S"),
    card("A", "H"),
    card("A", "D"), // 75 points: comes out
    card("2", "C"),
    card("9", "D"),
  ];
  const before = snap(game);
  E.drawFromOpenRow(game, "5C");
  E.layNewMeld(game, sel("AS", "AH", "AD"));
  if (!r.comeOut[0]) throw new Error("setup: should have come out");
  E.restartTurn(game);
  if (r.comeOut[0]) throw new Error("come-out should be undone");
  if (r.comeOutAccum[0] !== 0) throw new Error("accum should be reset");
  if (snap(game) !== before) throw new Error("state differs");
});

check("cards are conserved by a restart", () => {
  const game = setup();
  const r = game.round;
  const total = () =>
    r.hands[0].length +
    r.hands[1].length +
    r.openRow.length +
    r.closedPile.length +
    r.tableau.reduce((n, m) => n + m.slots.length, 0);
  const t0 = total();
  E.drawFromOpenRow(game, "5C");
  E.layNewMeld(game, sel("KS", "KH", "KD"));
  E.restartTurn(game);
  if (total() !== t0) throw new Error("cards lost or duplicated");
});

check("not available before any draw, or during a rearrange", () => {
  const game = setup();
  if (E.canRestartTurn(game)) throw new Error("nothing drawn yet");
  const g2 = setup();
  E.drawFromOpenRow(g2, "5C");
  if (!E.canRestartTurn(g2))
    throw new Error("should be available after a take");
  g2.round.rearrange = {
    cardById: {},
    originalOwnerByCardId: {},
    groups: {},
    handPool: [],
    nextGroupId: 0,
  };
  if (E.canRestartTurn(g2)) throw new Error("not during a rearrange session");
});

// Player 0 has come out; the opponent's 7-7-Joker is on the table; hand has
// the 7D that swaps the joker out but nothing that can replay the joker.
function swapSetup() {
  const game = setup();
  const r = game.round;
  r.tableau = [
    {
      id: "m1",
      type: "set",
      slots: [
        { card: card("7", "S"), ownerId: 1, wildAs: null },
        { card: card("7", "H"), ownerId: 1, wildAs: null },
        { card: card("JOKER"), ownerId: 1, wildAs: { rank: "7" } },
      ],
    },
  ];
  r.hands[0] = [card("7", "D"), card("2", "C"), card("9", "D"), card("K", "S")];
  r.closedPile = [card("3", "H"), card("4", "H")]; // draws 4H; the pile must not run empty
  return game;
}

check(
  "a swapped joker that cannot be replayed: restart returns to just after the pile draw",
  () => {
    const game = swapSetup();
    const r = game.round;
    E.drawFromClosedPile(game); // draws 4H
    const afterDraw = snap(game);
    E.swapJoker(game, "m1", "JOKERJ", "7D"); // the joker is now owed
    if (!throws(() => E.discard(game, "2C")))
      throw new Error("setup: the owed joker should block the discard");
    if (!E.canRestartTurn(game)) throw new Error("restart should be possible");
    E.restartTurn(game);
    if (snap(game) !== afterDraw)
      throw new Error("state differs from just after the draw");
    if (r.part !== 2)
      throw new Error("should stay in Part 2 (the draw is kept)");
    if (r.pendingObligations.length !== 0) throw new Error("joker still owed");
    if (!r.hands[0].some((c) => c.id === "4H"))
      throw new Error("the drawn card must stay in hand");
    E.discard(game, "2C"); // the turn can now end
    if (r.current !== 1) throw new Error("turn should have ended");
  },
);

check(
  "restart after a pile draw cannot be used to take from the cascade instead",
  () => {
    const game = swapSetup();
    E.drawFromClosedPile(game);
    E.swapJoker(game, "m1", "JOKERJ", "7D");
    E.restartTurn(game);
    if (E.canDrawFromRow(game))
      throw new Error("cascade take must stay closed");
    if (E.canDrawFromClosedPile(game)) throw new Error("no second pile draw");
    // and a second restart is still possible after another stuck swap
    E.swapJoker(game, "m1", "JOKERJ", "7D");
    if (!E.canRestartTurn(game)) throw new Error("second restart should work");
    E.restartTurn(game);
  },
);

check("the snapshot does not leak into the next turn", () => {
  const game = setup();
  const r = game.round;
  r.hands[0].push(card("5", "S"), card("5", "H"));
  E.drawFromOpenRow(game, "5C");
  E.layNewMeld(game, sel("5C", "5S", "5H"));
  E.discard(game, "2C");
  if (r.current !== 1) throw new Error("setup: turn should have ended");
  if (r.turnStart !== null) throw new Error("turnStart should be cleared");
  if (E.canRestartTurn(game)) throw new Error("nothing to restart");
});

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
