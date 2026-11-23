// An owed card stays owed until the turn ends (REGELS: the cascade card you
// grabbed "moet je deze beurt in een serie op tafel leggen" and can't be the
// discard; a swapped-out joker must be laid again the same turn). Laying it
// resolves the obligation only while it stays on the table: pulling it back,
// or moving it back to the hand in a rearrange, makes it owed again.
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

// A real 54-card round with player 0 to move (see rules_check34.js).
// Table entries: { type, cards: [[cardId, ownerId, wildRank?], ...] }.
function rig({
  hand0,
  row = ["2S"],
  tableau = [],
  part = 1,
  comeOut = true,
  undoFor,
}) {
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
  r.openRow = row.map(take);
  r.tableau = tableau.map((m, i) => ({
    id: `t${i}`,
    type: m.type,
    slots: m.cards.map(([id, ownerId, w]) => ({
      card: take(id),
      ownerId,
      wildAs: w ? { rank: w } : null,
    })),
  }));
  r.closedPile = all.filter((c) => !used.has(c.id));
  r.comeOut = [comeOut, true];
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
const lastMeldId = (game) => game.round.tableau.at(-1).id;

check(
  "cascade card laid, then pulled back: owed again, can't be discarded",
  () => {
    const g = rig({ hand0: ["6H", "7H", "KD", "2D"], row: ["5H"] });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.layNewMeld(g, sel("5H", "6H", "7H"));
    if (r.pendingObligations.length) throw new Error("5H should be resolved");
    E.pullFromMeld(g, lastMeldId(g), ["5H", "6H", "7H"]);
    // 5H is owed again as the cascade card; 6H 7H are owed because they were
    // pulled back (DESIGN decision 29).
    if (r.pendingObligations.slice().sort().join() !== "5H,6H,7H")
      throw new Error(`owed after pull: ${r.pendingObligations}`);
    if (r.rowObligationCardId !== "5H")
      throw new Error("5H is the row card again");
    if (!throws(() => E.discard(g, "5H")))
      throw new Error("discard 5H must be refused");
    if (!throws(() => E.discard(g, "KD")))
      throw new Error(
        "discarding another card must be refused while 5H is owed",
      );
    // Laying it again resolves it, and the turn can end.
    E.layNewMeld(g, sel("5H", "6H", "7H"));
    if (r.pendingObligations.length) throw new Error("5H laid again");
    E.discard(g, "KD");
    if (r.current !== 1) throw new Error("turn should pass");
    if (total(g) !== 54) throw new Error("card count changed");
  },
);

check("swapped-out joker laid, then pulled back: owed again", () => {
  const g = rig({
    hand0: ["7C", "QH", "QD", "3D"],
    part: 2,
    tableau: [
      {
        type: "set",
        cards: [
          ["7S", 1],
          ["7D", 1],
          ["JOKER-1", 1, "7"],
        ],
      },
    ],
  });
  const r = g.round;
  E.swapJoker(g, "t0", "JOKER-1", "7C");
  E.layNewMeld(g, [
    { cardId: "QH" },
    { cardId: "QD" },
    { cardId: "JOKER-1", wildAs: { rank: "Q" } },
  ]);
  if (r.pendingObligations.length) throw new Error("joker should be resolved");
  E.pullFromMeld(g, lastMeldId(g), ["QH", "QD", "JOKER-1"]);
  if (r.pendingObligations.slice().sort().join() !== "JOKER-1,QD,QH")
    throw new Error(`owed after pull: ${r.pendingObligations}`);
  if (r.rowObligationCardId !== null)
    throw new Error("a joker is not the row card");
  if (!throws(() => E.discard(g, "3D")))
    throw new Error("the turn must not end with the joker in hand");
  if (total(g) !== 54) throw new Error("card count changed");
});

check(
  "pulling back only another card of the series leaves the owed card resolved",
  () => {
    const g = rig({ hand0: ["6H", "7H", "8H", "KD"], row: ["5H"] });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.layNewMeld(g, sel("5H", "6H", "7H", "8H"));
    E.pullFromMeld(g, lastMeldId(g), ["8H"]); // 5-6-7 stays on the table
    // 5H stays resolved; only the pulled 8H is owed (decision 29).
    if (r.pendingObligations.join() !== "8H")
      throw new Error(`owed: ${r.pendingObligations}`);
    if (r.rowObligationCardId !== null)
      throw new Error("5H must stay resolved");
    E.addToMeld(g, lastMeldId(g), "8H");
    E.discard(g, "KD");
  },
);

check(
  "rearrange: owed card folded in, then moved back to the hand later: owed again",
  () => {
    const g = rig({
      hand0: ["9S", "9H", "9D", "2D"],
      row: ["5H"],
      tableau: [
        {
          type: "run",
          cards: [
            ["6H", 0],
            ["7H", 0],
            ["8H", 0],
          ],
        },
      ],
    });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.startRearrange(g);
    E.rearrangeMoveCard(g, "5H", "g0");
    let res = E.commitRearrange(g);
    if (!res.ok || r.pendingObligations.length)
      throw new Error("first commit should resolve 5H");
    E.startRearrange(g);
    E.rearrangeMoveCard(g, "5H", "hand");
    res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (r.pendingObligations.join() !== "5H")
      throw new Error(`owed after second commit: ${r.pendingObligations}`);
    if (!throws(() => E.discard(g, "5H")))
      throw new Error("discard 5H must be refused");
  },
);

check(
  "rearrange can't strand a previously laid owed card alone in the hand",
  () => {
    const g = rig({
      hand0: ["9S", "9H", "9D"],
      row: ["5H"],
      tableau: [
        {
          type: "run",
          cards: [
            ["6H", 0],
            ["7H", 0],
            ["8H", 0],
          ],
        },
      ],
    });
    const r = g.round;
    E.drawFromOpenRow(g, "5H");
    E.addToMeld(g, "t0", "5H"); // 5-6-7-8H, 5H resolved
    E.startRearrange(g);
    const rr = r.rearrange;
    E.rearrangeMoveCard(g, "9S", "new");
    const gid = Object.keys(rr.groups).find((k) => rr.groups[k][0] === "9S");
    E.rearrangeMoveCard(g, "9H", gid);
    E.rearrangeMoveCard(g, "9D", gid);
    E.rearrangeMoveCard(g, "5H", "hand"); // hand would be just 5H, owed again
    const res = E.commitRearrange(g);
    if (res.ok) throw new Error("commit must be refused");
    E.cancelRearrange(g);
    if (r.pendingObligations.length)
      throw new Error("cancel keeps 5H resolved");
  },
);

check(
  "a newer cascade take supersedes the old one: pulling the old card back owes nothing",
  () => {
    const g = rig({ hand0: ["6H", "7H", "QD", "KD", "2D"], row: ["5H", "JD"] });
    const r = g.round;
    E.drawFromOpenRow(g, "5H"); // takes 5H and JD, owes 5H
    E.layNewMeld(g, sel("5H", "6H", "7H"));
    // Take, lay, take again (decision 24): put a fresh card on the cascade.
    r.openRow.push(r.closedPile.pop());
    const top = r.openRow.at(-1).id;
    E.drawFromOpenRow(g, top); // newest take: owes `top`
    E.pullFromMeld(g, lastMeldId(g), ["5H", "6H", "7H"]);
    // The newest take is the row card; 5H is no longer owed as the cascade
    // card, only (like 6H 7H) because it was pulled back (decision 29).
    if (r.rowObligationCardId !== top)
      throw new Error(
        `the newest take should be the row card, got ${r.rowObligationCardId}`,
      );
    if (r.owedThisTurn.some((o) => o.cardId === "5H" && o.row))
      throw new Error("the old take's card should be superseded");
  },
);

check("undo after a pull-back returns to the laid, resolved state", () => {
  const g = rig({ hand0: ["6H", "7H", "KD", "2D"], row: ["5H"], undoFor: 0 });
  const r = g.round;
  E.drawFromOpenRow(g, "5H");
  E.layNewMeld(g, sel("5H", "6H", "7H"));
  E.pullFromMeld(g, lastMeldId(g), ["5H", "6H", "7H"]);
  E.undo(g);
  if (r.pendingObligations.length)
    throw new Error(`owed: ${r.pendingObligations}`);
  if (!r.tableau.some((m) => m.slots.some((s) => s.card.id === "5H")))
    throw new Error("5H should be back on the table");
});

check("taking back under-40 series restores the owed card as before", () => {
  const g = rig({
    hand0: ["6H", "7H", "KD", "2D"],
    row: ["5H"],
    comeOut: false,
  });
  const r = g.round;
  E.drawFromOpenRow(g, "5H");
  E.layNewMeld(g, sel("5H", "6H", "7H")); // 18 points, not out
  E.takeBackUnqualifiedMelds(g);
  if (r.pendingObligations.join() !== "5H") throw new Error("5H owed again");
  if (r.owedThisTurn.map((o) => o.cardId).join() !== "5H")
    throw new Error("owedThisTurn restored");
});

check("the next turn starts with nothing owed", () => {
  const g = rig({ hand0: ["6H", "7H", "KD", "2D"], row: ["5H"] });
  const r = g.round;
  E.drawFromOpenRow(g, "5H");
  E.layNewMeld(g, sel("5H", "6H", "7H"));
  E.discard(g, "KD");
  if (r.owedThisTurn.length)
    throw new Error(`still owed: ${r.owedThisTurn.map((o) => o.cardId)}`);
});

check(
  "a joker owed as the cascade card AND as a swap-out stays owed after a newer take",
  () => {
    const g = rig({
      hand0: ["7H", "8H", "QD", "QS", "KS", "2D"],
      row: ["QC", "JOKER-1"],
      tableau: [
        {
          type: "run",
          cards: [
            ["4H", 0],
            ["5H", 0],
            ["6H", 0],
          ],
        },
      ],
    });
    const r = g.round;
    E.drawFromOpenRow(g, "JOKER-1"); // the joker is the cascade card
    E.addToMeld(g, "t0", "JOKER-1", { rank: "7" });
    E.swapJoker(g, "t0", "JOKER-1", "7H"); // now also a swapped-out joker
    E.addToMeld(g, "t0", "JOKER-1", { rank: "8" });
    E.pullFromMeld(g, "t0", ["JOKER-1"]);
    if (r.rowObligationCardId === "JOKER-1")
      throw new Error("a swapped-out joker must stay a meld-only obligation");
    if (E.canStartRearrange(g))
      throw new Error("an owed swapped-out joker blocks starting a rearrange");
    E.drawFromOpenRow(g, "QC"); // take, lay, take again (decision 24)
    if (!r.pendingObligations.includes("JOKER-1"))
      throw new Error(`the joker must still be owed: ${r.pendingObligations}`);
    E.layNewMeld(g, sel("QC", "QD", "QS"));
    if (!throws(() => E.discard(g, "JOKER-1")))
      throw new Error("discarding the owed joker must be refused");
  },
);

check(
  "a joker swapped out twice counts once: a legal rearrange commit is accepted",
  () => {
    const g = rig({
      hand0: ["7C", "QH", "QD", "QS", "KH", "KD", "KS", "2D"],
      part: 2,
      tableau: [
        {
          type: "set",
          cards: [
            ["7S", 1],
            ["7D", 1],
            ["JOKER-1", 1, "7"],
          ],
        },
      ],
    });
    const r = g.round;
    E.swapJoker(g, "t0", "JOKER-1", "7C");
    const q = E.layNewMeld(g, [
      { cardId: "QH" },
      { cardId: "QD" },
      { cardId: "JOKER-1", wildAs: { rank: "Q" } },
    ]);
    E.swapJoker(g, q.id, "JOKER-1", "QS");
    E.layNewMeld(g, [
      { cardId: "KH" },
      { cardId: "KD" },
      { cardId: "KS" },
      { cardId: "JOKER-1", wildAs: { rank: "K" } },
    ]);
    if (r.owedThisTurn.length !== 1)
      throw new Error(
        `one entry for the joker, got ${JSON.stringify(r.owedThisTurn)}`,
      );
    // Hand 2D + joker, owing only the joker: allowed (pullFromMeld allows it too).
    E.startRearrange(g);
    E.rearrangeMoveCard(g, "JOKER-1", "hand");
    const res = E.commitRearrange(g);
    if (!res.ok) throw new Error(JSON.stringify(res.problems));
    if (r.pendingObligations.join() !== "JOKER-1")
      throw new Error("joker owed again");
  },
);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(
    "\nOK: an owed card stays owed until it is on the table at the end of the turn",
  );
}
