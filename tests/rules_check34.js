// A rearrange commit must leave the owed card layable (DESIGN §3 decision 16,
// the guard every other meld action runs via assertLeavesHandUsable): after
// taking from the cascade, a session that leaves the hand holding only the
// owed card would strand the player -- the card can't be discarded (decision
// 25) and every meld action has to keep a card behind.
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

// A real 54-card round with player 0 to move: every card lives in exactly one
// zone (hands, cascade, table, closed pile). Table entries are
// { type, cards: [[cardId, ownerId], ...] }.
function rig({ hand0, row, tableau = [], part = 1 }) {
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
  r.openRow = row.map(take);
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
  r.part = part;
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
// Move the given hand cards into one new group; returns the group id.
function newGroup(game, ids) {
  const rr = game.round.rearrange;
  E.rearrangeMoveCard(game, ids[0], "new");
  const gid = Object.keys(rr.groups).find((k) => rr.groups[k][0] === ids[0]);
  for (const id of ids.slice(1)) E.rearrangeMoveCard(game, id, gid);
  return gid;
}
const heartsRun = {
  type: "run",
  cards: [
    ["6H", 0],
    ["7H", 0],
    ["8H", 0],
  ],
};

check("commit that leaves only the owed card in hand is refused", () => {
  const g = rig({
    hand0: ["9S", "9H", "9D"],
    row: ["5H"],
    tableau: [heartsRun],
  });
  const r = g.round;
  E.drawFromOpenRow(g, "5H");
  // The plain action is already refused...
  if (!throws(() => E.layNewMeld(g, sel("9S", "9H", "9D"))))
    throw new Error("layNewMeld 9-9-9 should be refused (only 5H left)");
  // ...and the same move through a rearrange session must be refused too.
  E.startRearrange(g);
  newGroup(g, ["9S", "9H", "9D"]);
  const res = E.commitRearrange(g);
  if (res.ok) throw new Error("commit should report a problem");
  if (!res.problems.some((p) => /owe/.test(p.error)))
    throw new Error(`unexpected problems: ${JSON.stringify(res.problems)}`);
  if (!r.rearrange) throw new Error("the session should stay open");
  if (r.hands[0].length !== 4) throw new Error("the hand must be untouched");
  if (total(g) !== 54) throw new Error("card count changed");
  // Cancelling gets back to exactly the pre-session state.
  E.cancelRearrange(g);
  if (r.rearrange) throw new Error("cancel should close the session");
  if (!r.pendingObligations.includes("5H")) throw new Error("5H still owed");
});

check(
  "owed card folded in, another card kept: commit succeeds and 5H is no longer owed",
  () => {
    const g = rig({
      hand0: ["9S", "9H", "9D", "KC"],
      row: ["5H"],
      tableau: [heartsRun],
    });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.startRearrange(g);
    newGroup(g, ["9S", "9H", "9D"]);
    E.rearrangeMoveCard(g, "5H", "g0");
    const res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (r.pendingObligations.length !== 0)
      throw new Error("5H should be resolved");
    if (r.hands[0].map((c) => c.id).join() !== "KC")
      throw new Error(`hand: ${r.hands[0].map((c) => c.id)}`);
    if (total(g) !== 54) throw new Error("card count changed");
  },
);

check(
  "owed card left in hand next to another card: commit succeeds, 5H still owed",
  () => {
    const g = rig({
      hand0: ["9S", "9H", "9D", "KC"],
      row: ["5H"],
      tableau: [heartsRun],
    });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.startRearrange(g);
    newGroup(g, ["9S", "9H", "9D"]);
    const res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (!r.pendingObligations.includes("5H")) throw new Error("5H still owed");
    if (r.hands[0].length !== 2) throw new Error("hand should be KC + 5H");
    // And it can still be laid: add 5H to 6-7-8H.
    E.addToMeld(g, "g0", "5H");
    if (r.pendingObligations.length !== 0) throw new Error("5H should be laid");
  },
);

check("no obligation: a commit may still leave a single card in hand", () => {
  const g = rig({ hand0: ["9S", "9H", "9D", "KC"], row: ["2D"], part: 2 });
  const r = g.round;
  E.startRearrange(g);
  newGroup(g, ["9S", "9H", "9D"]);
  const res = E.commitRearrange(g);
  if (!res.ok) throw new Error(JSON.stringify(res.problems));
  if (r.hands[0].length !== 1) throw new Error("hand should be KC");
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nOK: rearrange commits keep the owed card layable");
}
