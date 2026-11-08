// Cards pulled back from the table must be laid again the same turn (DESIGN
// decision 29, confirmed by the owner 2026-11-08): a pulled card is owed --
// it can't be discarded or kept -- also when a rearrange moves a table card
// to the hand. So a player can't pull back the series they came out with
// and stay "out" with nothing on the table.
import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;

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

// A real 54-card round, player 0 to move in Part 2 (see rules_check34.js).
function rig({ hand0, tableau = [], comeOut = true, undoFor }) {
  const game = E.newGame("standard", () => 0.1);
  if (undoFor !== undefined) game.undoFor = undoFor;
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  const r = game.round;
  const all = E.buildDeck();
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  const used = new Set();
  const take = (id) => {
    if (!byId[id] || used.has(id)) throw new Error(`bad or duplicate ${id}`);
    used.add(id);
    return byId[id];
  };
  r.hands = [hand0.map(take), ["2C", "3C", "4C", "5C", "6C"].map(take)];
  r.openRow = [take("2S")];
  r.tableau = tableau.map((m, i) => ({
    id: `t${i}`,
    type: m.type,
    slots: m.cards.map(([id, ownerId]) => ({
      card: take(id),
      ownerId,
      wildAs: null,
    })),
  }));
  r.closedPile = all.filter((c) => !used.has(c.id));
  r.comeOut = [comeOut, true];
  r.current = 0;
  r.part = 2;
  r.turnStart = null;
  return game;
}
const total = (game) => {
  const r = game.round;
  return (
    r.closedPile.length +
    r.openRow.length +
    r.hands[0].length +
    r.hands[1].length +
    r.tableau.reduce((n, m) => n + m.slots.length, 0)
  );
};
const kings = {
  type: "set",
  cards: [
    ["KS", 0],
    ["KH", 0],
    ["KD", 0],
  ],
};
const nines = {
  type: "set",
  cards: [
    ["9S", 0],
    ["9H", 0],
    ["9D", 0],
  ],
};

check(
  "a pulled-back series is owed: no discard until it's back on the table",
  () => {
    const g = rig({ hand0: ["2D", "QC"], tableau: [kings] });
    const r = g.round;
    E.pullFromMeld(g, "t0", ["KS", "KH", "KD"]);
    if (r.pendingObligations.slice().sort().join() !== "KD,KH,KS")
      throw new Error(`owed: ${r.pendingObligations}`);
    if (!throws(() => E.discard(g, "2D")))
      throw new Error("the turn must not end with pulled cards in hand");
    if (!throws(() => E.discard(g, "KS")))
      throw new Error("a pulled card must not be discarded");
    E.layNewMeld(g, sel("KS", "KH", "KD"));
    if (r.pendingObligations.length)
      throw new Error("laid again: nothing owed");
    E.discard(g, "2D");
    if (r.current !== 1) throw new Error("turn should pass");
    if (total(g) !== 54) throw new Error("card count changed");
  },
);

check(
  "come out, pull both series back, can't end the turn with them in hand",
  () => {
    const g = rig({
      hand0: ["KS", "KH", "KD", "9S", "9H", "9D", "2D"],
      comeOut: false,
    });
    const r = g.round;
    E.layNewMeld(g, sel("KS", "KH", "KD"));
    E.layNewMeld(g, sel("9S", "9H", "9D")); // 30 + 15 = 45: out
    if (!r.comeOut[0]) throw new Error("should have come out");
    const ids = r.tableau.map((m) => m.id);
    E.pullFromMeld(g, ids[0], ["KS", "KH", "KD"]);
    E.pullFromMeld(g, ids[1], ["9S", "9H", "9D"]);
    if (r.tableau.length) throw new Error("table should be empty");
    if (!throws(() => E.discard(g, "2D")))
      throw new Error("can't stay out with nothing on the table");
  },
);

check(
  "pulling one card off a series: owed, and adding it back resolves it",
  () => {
    const g = rig({
      hand0: ["2D", "QC"],
      tableau: [
        {
          type: "run",
          cards: [
            ["5H", 0],
            ["6H", 0],
            ["7H", 0],
            ["8H", 0],
          ],
        },
      ],
    });
    const r = g.round;
    E.pullFromMeld(g, "t0", ["8H"]);
    if (r.pendingObligations.join() !== "8H")
      throw new Error(`owed: ${r.pendingObligations}`);
    E.addToMeld(g, "t0", "8H");
    if (r.pendingObligations.length)
      throw new Error("added back: nothing owed");
    E.discard(g, "2D");
  },
);

check(
  "pulled, laid, pulled again: still owed (no escape by repetition)",
  () => {
    const g = rig({ hand0: ["2D", "QC"], tableau: [kings] });
    const r = g.round;
    E.pullFromMeld(g, "t0", ["KS", "KH", "KD"]);
    const m = E.layNewMeld(g, sel("KS", "KH", "KD"));
    E.pullFromMeld(g, m.id, ["KS", "KH", "KD"]);
    if (r.pendingObligations.length !== 3)
      throw new Error(`owed: ${r.pendingObligations}`);
    if (r.owedThisTurn.length !== 3) throw new Error("one owed entry per card");
  },
);

check(
  "a pulled card doesn't block starting a rearrange, which can fold it back",
  () => {
    const g = rig({ hand0: ["2D", "QC"], tableau: [kings, nines] });
    const r = g.round;
    E.pullFromMeld(g, "t0", ["KS", "KH", "KD"]);
    if (!E.canStartRearrange(g)) throw new Error("rearrange should be allowed");
    E.startRearrange(g);
    const rr = r.rearrange;
    E.rearrangeMoveCard(g, "KS", "new");
    const gid = Object.keys(rr.groups).find((k) => rr.groups[k][0] === "KS");
    E.rearrangeMoveCard(g, "KH", gid);
    E.rearrangeMoveCard(g, "KD", gid);
    const res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (r.pendingObligations.length)
      throw new Error(`owed: ${r.pendingObligations}`);
    E.discard(g, "2D");
  },
);

check("a rearrange that moves a table card to the hand makes it owed", () => {
  const g = rig({
    hand0: ["2D", "QC"],
    tableau: [
      {
        type: "run",
        cards: [
          ["5H", 0],
          ["6H", 0],
          ["7H", 0],
          ["8H", 0],
        ],
      },
    ],
  });
  const r = g.round;
  E.startRearrange(g);
  E.rearrangeMoveCard(g, "8H", "hand");
  const res = E.commitRearrange(g);
  if (!res.ok) throw new Error(JSON.stringify(res.problems));
  if (r.pendingObligations.join() !== "8H")
    throw new Error(`owed: ${r.pendingObligations}`);
  if (!throws(() => E.discard(g, "8H")))
    throw new Error("8H can't be the discard");
});

check("a rearrange may not leave the hand holding only pulled cards", () => {
  const run = {
    type: "run",
    cards: [
      ["5H", 0],
      ["6H", 0],
      ["7H", 0],
    ],
  };
  const g = rig({ hand0: ["8H"], tableau: [run, kings] });
  const r = g.round;
  E.startRearrange(g);
  E.rearrangeMoveCard(g, "8H", "g0"); // 5-6-7-8H
  for (const id of ["KS", "KH", "KD"]) E.rearrangeMoveCard(g, id, "hand");
  const res = E.commitRearrange(g);
  if (res.ok) throw new Error("hand = 3 owed kings only: must be refused");
  E.cancelRearrange(g);
  // Keeping 8H in hand next to the kings is fine.
  E.startRearrange(g);
  for (const id of ["KS", "KH", "KD"]) E.rearrangeMoveCard(g, id, "hand");
  const ok = E.commitRearrange(g);
  if (!ok.ok) throw new Error(JSON.stringify(ok.problems));
  if (r.pendingObligations.length !== 3) throw new Error("the kings are owed");
});

check("undo after a pull-back clears the obligation with it", () => {
  const g = rig({ hand0: ["2D", "QC"], tableau: [kings], undoFor: 0 });
  const r = g.round;
  E.pullFromMeld(g, "t0", ["KS", "KH", "KD"]);
  E.undo(g);
  if (r.pendingObligations.length || r.owedThisTurn.length)
    throw new Error("undo should restore the state before the pull");
  E.discard(g, "2D");
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nOK: pulled-back cards must be laid again the same turn");
}
