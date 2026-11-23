// You may only pull back cards you laid THIS turn (REGELS as rewritten by the
// designer, accepted by the owner 2026-11-08; DESIGN decision 30). Cards from
// earlier turns can't be pulled back, and a rearrange may regroup them on the
// table but not take them into the hand.
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
const throwsWith = (fn, re) => {
  try {
    fn();
  } catch (e) {
    return re.test(e.message);
  }
  return false;
};
const sel = (...ids) => ids.map((cardId) => ({ cardId }));

// A real 54-card round, player 0 to move in Part 2. `earlier`: the table was
// already there when this turn began (laid in an earlier turn).
function rig({ hand0, tableau = [], earlier = true }) {
  const game = E.newGame("standard", () => 0.1);
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
  r.comeOut = [true, true];
  r.current = 0;
  r.part = 2;
  r.tableAtTurnStart = earlier
    ? r.tableau.flatMap((m) => m.slots.map((s) => s.card.id))
    : [];
  return game;
}
const kings = {
  type: "set",
  cards: [
    ["KS", 0],
    ["KH", 0],
    ["KD", 0],
    ["KC", 0],
  ],
};

check("a card laid in an earlier turn can't be pulled back", () => {
  const g = rig({ hand0: ["2D", "QC"], tableau: [kings] });
  if (E.isLaidThisTurn(g, "KC")) throw new Error("KC was laid earlier");
  if (!throwsWith(() => E.pullFromMeld(g, "t0", ["KC"]), /earlier turn/))
    throw new Error("pulling KC must be refused with the reason");
  if (g.round.tableau[0].slots.length !== 4) throw new Error("table unchanged");
});

check("a card laid this turn can be pulled back (and is then owed)", () => {
  const g = rig({ hand0: ["9S", "9H", "9D", "9C", "2D"], tableau: [kings] });
  const m = E.layNewMeld(g, sel("9S", "9H", "9D", "9C"));
  if (!E.isLaidThisTurn(g, "9C")) throw new Error("9C was laid this turn");
  E.pullFromMeld(g, m.id, ["9C"]);
  if (!g.round.pendingObligations.includes("9C"))
    throw new Error("a pulled card is owed (decision 29)");
});

check(
  "real flow: lay, discard, the other player's turn -- then it's an earlier card",
  () => {
    const g = rig({
      hand0: ["9S", "9H", "9D", "9C", "2D", "QD"],
      tableau: [],
      earlier: false,
    });
    const r = g.round;
    const m = E.layNewMeld(g, sel("9S", "9H", "9D", "9C"));
    E.discard(g, "2D");
    // player 2: draw and discard
    E.drawFromClosedPile(g);
    E.discard(g, r.hands[1][0].id);
    // player 1 again
    E.drawFromClosedPile(g);
    if (r.current !== 0 || r.part !== 2)
      throw new Error("should be player 1, Part 2");
    if (E.isLaidThisTurn(g, "9C"))
      throw new Error("9C is from an earlier turn now");
    if (!throwsWith(() => E.pullFromMeld(g, m.id, ["9C"]), /earlier turn/))
      throw new Error("pulling an earlier turn's card must be refused");
  },
);

check(
  "rearrange: an earlier card may move between series, not into the hand",
  () => {
    const g = rig({
      hand0: ["QC", "2D"],
      tableau: [
        kings,
        {
          type: "set",
          cards: [
            ["QS", 0],
            ["QH", 0],
            ["QD", 0],
          ],
        },
      ],
    });
    const r = g.round;
    // KC to the hand: refused, session stays open.
    E.startRearrange(g);
    E.rearrangeMoveCard(g, "KC", "hand");
    let res = E.commitRearrange(g);
    if (res.ok || !res.problems.some((p) => /earlier turn/.test(p.error)))
      throw new Error(`should be refused: ${JSON.stringify(res)}`);
    E.cancelRearrange(g);
    // QC from the hand into the queens, KC stays: fine.
    E.startRearrange(g);
    E.rearrangeMoveCard(g, "QC", "g1");
    res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (
      r.tableau.find((m) => m.slots.some((s) => s.card.id === "QC")).slots
        .length !== 4
    )
      throw new Error("QC should join the queens");
  },
);

check(
  "a joker swapped out and laid again this turn counts as laid this turn",
  () => {
    const g = rig({
      hand0: ["7H", "9S", "9D", "9H", "2D", "QC"],
      tableau: [
        {
          type: "run",
          cards: [
            ["4H", 1],
            ["5H", 1],
            ["6H", 1],
          ],
        },
      ],
    });
    const r = g.round;
    // The opponent's earlier run ends in a joker standing in for 7H.
    r.tableau[0].slots.push({
      card: { id: "JOKER-1", rank: "JOKER", suit: null },
      ownerId: 1,
      wildAs: { rank: "7" },
    });
    r.closedPile = r.closedPile.filter((c) => c.id !== "JOKER-1");
    r.tableAtTurnStart.push("JOKER-1");
    E.swapJoker(g, "t0", "JOKER-1", "7H");
    const m = E.layNewMeld(g, [
      { cardId: "9S" },
      { cardId: "9D" },
      { cardId: "9H" },
      { cardId: "JOKER-1", wildAs: { rank: "9" } },
    ]);
    if (!E.isLaidThisTurn(g, "JOKER-1"))
      throw new Error("the relaid joker was laid this turn");
    E.pullFromMeld(g, m.id, ["JOKER-1"]); // allowed (and owed again)
    if (!r.pendingObligations.includes("JOKER-1"))
      throw new Error("joker owed");
  },
);

check("undo and Start turn over keep the turn-start table", () => {
  const g = rig({
    hand0: ["7H", "9S", "9H", "9D", "2D"],
    tableau: [
      kings,
      {
        type: "run",
        cards: [
          ["4H", 1],
          ["5H", 1],
          ["6H", 1],
        ],
      },
    ],
  });
  g.undoFor = 0;
  const r = g.round;
  r.tableau[1].slots.push({
    card: { id: "JOKER-1", rank: "JOKER", suit: null },
    ownerId: 1,
    wildAs: { rank: "7" },
  });
  r.closedPile = r.closedPile.filter((c) => c.id !== "JOKER-1");
  r.tableAtTurnStart.push("JOKER-1");
  r.turnStart = null;
  // a pile draw sets the Start-turn-over point
  r.part = 1;
  E.drawFromClosedPile(g);
  const before = r.tableAtTurnStart.slice().sort().join();
  E.layNewMeld(g, sel("9S", "9H", "9D"));
  E.undo(g);
  if (r.tableAtTurnStart.slice().sort().join() !== before)
    throw new Error("changed by undo");
  E.swapJoker(g, "t1", "JOKER-1", "7H"); // takes the joker off the list
  if (!E.isLaidThisTurn(g, "JOKER-1")) throw new Error("swap should unlist it");
  E.restartTurn(g);
  if (r.tableAtTurnStart.slice().sort().join() !== before)
    throw new Error("Start turn over should restore the turn-start table");
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nOK: only cards laid this turn can be pulled back");
}
