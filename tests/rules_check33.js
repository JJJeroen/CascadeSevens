// Step-by-step undo within a turn (DESIGN decision 28): the undo-enabled seat
// (game.undoFor, the human in the app) can take back its last action, as often
// as it likes, but never back past drawing from the pile.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";
const E = CascadeEngine;
const noop = { onStateChanged: () => {} };
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
const same = (a, b, msg) => {
  if (a !== b)
    throw new Error(
      `${msg}\n  was: ${a.slice(0, 300)}\n  now: ${b.slice(0, 300)}`,
    );
};
// The round without the log and the undo stack (what undo restores).
const state = (game) => {
  const { log, undoStack, ...rest } = game.round;
  void log;
  void undoStack;
  return JSON.stringify(rest);
};
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
const owned = (cards, ownerId) =>
  cards.map((c) => ({ card: c, ownerId, wildAs: null }));

// Player 0 to move in Part 2 (after a pile draw), undo enabled for seat 0.
function setup(hand, { tableau = [], comeOut = true, undoFor = 0 } = {}) {
  const game = E.newGame("standard", () => 0.1);
  if (undoFor !== null) game.undoFor = undoFor;
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  const r = game.round;
  r.current = 0;
  r.comeOut = [comeOut, comeOut];
  E.drawFromClosedPile(game);
  r.hands[0] = hand;
  r.tableau = tableau;
  return game;
}

check("laying a series can be undone, exactly", () => {
  const game = setup([
    card("9", "S"),
    card("9", "H"),
    card("9", "D"),
    card("2", "C"),
  ]);
  const before = state(game);
  E.layNewMeld(game, sel("9S", "9H", "9D"));
  if (!E.canUndo(game)) throw new Error("undo should be available");
  E.undo(game);
  same(before, state(game), "state differs after undo");
  if (E.canUndo(game)) throw new Error("nothing should be left to undo");
});

check("the 999 case: lay 999, undo, then lay 6-7-8-9 instead", () => {
  const game = setup([
    card("9", "S"),
    card("9", "H"),
    card("9", "D"),
    card("6", "D"),
    card("7", "D"),
    card("8", "D"),
    card("K", "C"),
  ]);
  E.layNewMeld(game, sel("9S", "9H", "9D"));
  E.undo(game);
  E.layNewMeld(game, sel("6D", "7D", "8D", "9D"));
  const t = game.round.tableau;
  if (t.length !== 1 || t[0].slots.length !== 4)
    throw new Error("the run was not laid");
  if (!game.round.hands[0].some((c) => c.id === "9S"))
    throw new Error("9S should be back in hand");
});

check("adding a card and pulling cards back can be undone", () => {
  const set = {
    id: "m1",
    type: "set",
    slots: owned([card("7", "S"), card("7", "H"), card("7", "D")], 0),
  };
  const game = setup([card("7", "C"), card("2", "C"), card("K", "D")], {
    tableau: [set],
  });
  const s0 = state(game);
  E.addToMeld(game, "m1", "7C");
  const s1 = state(game);
  E.pullFromMeld(game, "m1", ["7S", "7H", "7D", "7C"]); // the whole series back
  E.undo(game);
  same(s1, state(game), "undo of the pull did not restore the 4-card set");
  E.undo(game);
  same(s0, state(game), "undo of the add did not restore the 3-card set");
});

check("a joker swap can be undone, with the joker it left owed", () => {
  const set = {
    id: "m1",
    type: "set",
    slots: [
      { card: card("7", "S"), ownerId: 1, wildAs: null },
      { card: card("7", "H"), ownerId: 1, wildAs: null },
      { card: card("JOKER"), ownerId: 1, wildAs: { rank: "7" } },
    ],
  };
  const game = setup(
    [card("7", "D"), card("2", "C"), card("K", "D"), card("K", "S")],
    { tableau: [set] },
  );
  const before = state(game);
  E.swapJoker(game, "m1", "JOKERJ", "7D");
  if (game.round.pendingObligations.length === 0)
    throw new Error("setup: the joker should be owed");
  E.undo(game);
  same(before, state(game), "swap not undone");
  if (game.round.pendingObligations.length !== 0)
    throw new Error("the owed joker should be gone");
});

check("several steps undo in reverse order; then nothing is left", () => {
  const game = setup([
    card("9", "S"),
    card("9", "H"),
    card("9", "D"),
    card("9", "C"),
    card("4", "C"),
    card("4", "H"),
    card("4", "D"),
    card("K", "C"),
  ]);
  const s0 = state(game);
  E.layNewMeld(game, sel("9S", "9H", "9D"));
  const s1 = state(game);
  E.addToMeld(game, game.round.tableau[0].id, "9C");
  const s2 = state(game);
  E.layNewMeld(game, sel("4C", "4H", "4D"));
  E.undo(game);
  same(s2, state(game), "step 3");
  E.undo(game);
  same(s1, state(game), "step 2");
  E.undo(game);
  same(s0, state(game), "step 1");
  if (E.canUndo(game)) throw new Error("the stack should be empty");
  if (!throws(() => E.undo(game)))
    throw new Error("undo with nothing to undo should throw");
});

check(
  "rearrange: undo goes back to before the session; cancel leaves nothing",
  () => {
    const set = {
      id: "m1",
      type: "set",
      slots: owned([card("7", "S"), card("7", "H"), card("7", "D")], 0),
    };
    const game = setup([card("7", "C"), card("2", "C"), card("3", "C")], {
      tableau: [set],
    });
    const before = state(game);
    E.startRearrange(game);
    E.cancelRearrange(game);
    if (E.canUndo(game))
      throw new Error("a cancelled session must leave no undo step");
    same(before, state(game), "cancel changed the state");
    E.startRearrange(game);
    const gid = E.rearrangeState(game).groups[0].groupId;
    E.rearrangeMoveCard(game, "7C", gid);
    if (!E.commitRearrange(game).ok)
      throw new Error("setup: commit should succeed");
    if (game.round.tableau[0].slots.length !== 4)
      throw new Error("setup: 7C should be in the set");
    E.undo(game);
    same(
      before,
      state(game),
      "undo should restore the position before the rearrange",
    );
    if (game.round.rearrange) throw new Error("no session should be active");
  },
);

check("take back (under 40) can be undone", () => {
  const game = setup(
    [
      card("2", "C"),
      card("3", "C"),
      card("4", "C"),
      card("9", "S"),
      card("K", "D"),
    ],
    { comeOut: false },
  );
  const s0 = state(game);
  E.layNewMeld(game, sel("2C", "3C", "4C"));
  const s1 = state(game);
  E.takeBackUnqualifiedMelds(game);
  E.undo(game);
  same(
    s1,
    state(game),
    "undo of take back should put the series (and its points) back",
  );
  E.undo(game);
  same(s0, state(game), "undo of the lay");
});

check(
  "cascade take, lay, then undo twice: lay, then the older pickup undo",
  () => {
    const game = E.newGame("standard", () => 0.1);
    game.undoFor = 0;
    E.startRound(game, () => 0.5);
    E.turn0Decline(game);
    E.turn0Decline(game);
    const r = game.round;
    r.current = 0;
    r.comeOut = [true, true];
    r.openRow = [card("5", "C")];
    r.hands[0] = [
      card("5", "D"),
      card("5", "H"),
      card("K", "S"),
      card("2", "C"),
      card("9", "D"),
    ];
    const rowBefore = JSON.stringify(r.openRow);
    const handBefore = JSON.stringify(r.hands[0]);
    E.drawFromOpenRow(game, "5C"); // Part 1: not an undo step, the older mechanism covers it
    E.layNewMeld(game, sel("5C", "5D", "5H"));
    if (E.canUndoDraw(game))
      throw new Error("setup: laying closes the pickup undo window");
    E.undo(game); // takes back the lay
    if (!E.canUndoDraw(game))
      throw new Error("after undoing the lay the pickup can be undone");
    if (E.canUndo(game)) throw new Error("the step stack should be empty now");
    E.undoDraw(game);
    same(
      rowBefore,
      JSON.stringify(r.openRow),
      "the cascade should be back as it was",
    );
    same(
      handBefore,
      JSON.stringify(r.hands[0]),
      "the hand should be back as it was",
    );
  },
);

check("no undo before the draw, and never back past a pile draw", () => {
  const game = E.newGame("standard", () => 0.1);
  game.undoFor = 0;
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  game.round.current = 0;
  if (E.canUndo(game)) throw new Error("no undo in Part 1");
  E.drawFromClosedPile(game);
  if (E.canUndo(game))
    throw new Error("right after the draw there is nothing to undo");
  game.round.hands[0] = [
    card("9", "S"),
    card("9", "H"),
    card("9", "D"),
    card("2", "C"),
  ];
  E.layNewMeld(game, sel("9S", "9H", "9D"));
  E.undo(game);
  if (E.canUndo(game)) throw new Error("the stack must stop at the draw");
  if (game.round.part !== 2) throw new Error("still in Part 2 after undo");
});

check(
  "take, lay, Start turn over, pile draw: undo cannot reach back past the draw",
  () => {
    const game = E.newGame("standard", () => 0.1);
    game.undoFor = 0;
    E.startRound(game, () => 0.5);
    E.turn0Decline(game);
    E.turn0Decline(game);
    const r = game.round;
    r.current = 0;
    r.comeOut = [true, true];
    r.openRow = [card("5", "C")];
    r.hands[0] = [
      card("5", "D"),
      card("5", "H"),
      card("K", "S"),
      card("2", "C"),
      card("9", "D"),
    ];
    E.drawFromOpenRow(game, "5C"); // Part 1: cascade take
    E.layNewMeld(game, sel("5C", "5D", "5H")); // a recorded step
    if (!E.canUndo(game)) throw new Error("setup: a step should be recorded");
    E.restartTurn(game); // back to Part 1
    E.drawFromClosedPile(game); // the pile card has now been seen
    if (E.canUndo(game) || r.undoStack.length !== 0)
      throw new Error(
        "no step may survive the pile draw (the pile card would be un-seen)",
      );
    if (!throws(() => E.undo(game)))
      throw new Error("undo must refuse after the pile draw");
  },
);

check(
  "only the undo-enabled seat records; AI games and the other seat do not",
  () => {
    const ai = setup(
      [card("9", "S"), card("9", "H"), card("9", "D"), card("2", "C")],
      { undoFor: null },
    );
    E.layNewMeld(ai, sel("9S", "9H", "9D"));
    if (ai.round.undoStack.length !== 0 || E.canUndo(ai))
      throw new Error("undoFor unset: nothing should be recorded");
    const game = setup([
      card("9", "S"),
      card("9", "H"),
      card("9", "D"),
      card("2", "C"),
    ]);
    const r = game.round;
    r.current = 1; // the AI's turn in an undo-for-seat-0 game
    r.hands[1] = [
      card("8", "S"),
      card("8", "H"),
      card("8", "D"),
      card("2", "D"),
    ];
    E.layNewMeld(game, sel("8S", "8H", "8D"));
    if (r.undoStack.length !== 0 || E.canUndo(game))
      throw new Error("the other seat must not record");
  },
);

check(
  "a failed action leaves no step; ending the turn clears the stack",
  () => {
    const game = setup([
      card("9", "S"),
      card("9", "H"),
      card("9", "D"),
      card("2", "C"),
      card("K", "C"),
    ]);
    if (!throws(() => E.layNewMeld(game, sel("9S", "2C", "KC"))))
      throw new Error("setup: that should be illegal");
    if (game.round.undoStack.length !== 0)
      throw new Error("a failed action must not record a step");
    E.layNewMeld(game, sel("9S", "9H", "9D"));
    E.discard(game, "2C");
    if (game.round.undoStack.length !== 0)
      throw new Error("the stack should be cleared when the turn ends");
    if (game.round.current !== 1)
      throw new Error("setup: it should be the other player's turn");
  },
);

check("undo restores in place (same Round object) and keeps 54 cards", () => {
  const game = setup([
    card("9", "S"),
    card("9", "H"),
    card("9", "D"),
    card("2", "C"),
  ]);
  const round = game.round;
  const n = total(game);
  E.layNewMeld(game, sel("9S", "9H", "9D"));
  E.undo(game);
  if (game.round !== round)
    throw new Error(
      "the Round object must stay the same one (the AI keys its memory on it)",
    );
  if (total(game) !== n) throw new Error(`cards ${n} -> ${total(game)}`);
  const last = round.log[round.log.length - 1];
  if (!/undid their last action/.test(last))
    throw new Error(`unexpected last log line: ${last}`);
});

// Randomised: the human seat plays random legal actions, then undoes them all;
// every intermediate state must come back exactly, with all 54 cards present.
check("random play: undoing every action restores every earlier state", () => {
  let undone = 0;
  for (let g = 0; g < 150; g++) {
    const rng = E.seededRng(g * 977 + 3);
    const pick = E.seededRng(g * 131 + 7);
    const game = E.newGame("quick", rng);
    game.undoFor = 0;
    E.startRound(game, rng);
    for (let t = 0; t < 120 && !game.round.ended; t++) {
      let r = game.round;
      const mover = r.part === "turn0" ? E.turn0CurrentAskee(game) : r.current;
      if (mover !== 0 || r.part === "turn0") {
        CascadeAI.takeTurn(game, noop, "intermediate");
        continue;
      }
      if (r.part === 1) E.drawFromClosedPile(game);
      r = game.round;
      if (r.ended) break;
      const history = [state(game)];
      for (let k = 0; k < 6; k++) {
        const hand = r.hands[0];
        const before = r.undoStack.length;
        try {
          const kind = Math.floor(pick() * 3);
          if (kind === 0 && hand.length >= 4) {
            const ids = [0, 1, 2].map(
              () => hand[Math.floor(pick() * hand.length)].id,
            );
            const res = E.autoResolveMeld(hand, [...new Set(ids)]);
            if (res.ok) E.layNewMeld(game, res.slots);
          } else if (kind === 1 && r.tableau.length > 0 && hand.length >= 2) {
            const meld = r.tableau[Math.floor(pick() * r.tableau.length)];
            const c = hand[Math.floor(pick() * hand.length)];
            const res = E.autoResolveAddToMeld(meld, c);
            if (res) E.addToMeld(game, meld.id, c.id, res.wildAs);
          } else if (kind === 2 && r.tableau.length > 0) {
            const meld = r.tableau[Math.floor(pick() * r.tableau.length)];
            const mine = meld.slots.filter((sl) => sl.ownerId === 0);
            if (mine.length > 0)
              E.pullFromMeld(game, meld.id, [mine[0].card.id]);
          }
        } catch {
          /* an illegal random action: nothing must have been recorded */
        }
        if (r.undoStack.length === before + 1) history.push(state(game));
        else if (r.undoStack.length !== before)
          throw new Error("a step was recorded or lost wrongly");
      }
      for (let i = history.length - 1; i >= 1; i--) {
        E.undo(game);
        undone++;
        same(
          history[i - 1],
          state(game),
          `game ${g} turn ${t}: step ${i} did not restore`,
        );
        if (total(game) !== 54) throw new Error(`card count ${total(game)}`);
      }
      if (E.canUndo(game))
        throw new Error("stack should be empty after undoing everything");
      CascadeAI.takeTurn(game, noop, "intermediate"); // finish this turn
    }
  }
  if (undone < 100) throw new Error(`only ${undone} undos exercised`);
  console.log(`  (${undone} undos checked)`);
});

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL RULE CHECKS PASSED");
