// Story #18: AI opponent uses tableau rearrangement. Before this, docs/ai.js
// never called pullFromMeld/the rearrange session at all -- an obligated
// card (row-take or joker-swap) that couldn't be placed by a direct add or
// a brand-new meld from hand alone would just strand the AI into its
// existing undo/discard-back fallback, even in cases a human player could
// clearly resolve by dissolving one of their own melds and reforming it
// with the obligated card.
import { CascadeEngine } from "../docs/engine.js";
import { CascadeAI } from "../docs/ai.js";
const E = CascadeEngine;
function card(rank, suit) {
  return { id: `${rank}${suit || ""}`, rank, suit: suit || null };
}

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

// Table has the AI's own heart run 5H-6H-7H. The AI's hand holds the
// obligated 7S plus a lone 7C -- two sevens, one short of a set, and 7S
// can't legally extend the heart run (wrong suit) or be laid as a new meld
// on its own. Only dissolving the whole run frees the 7H that completes
// 7S-7C-7H as a valid set.
function freshStrandedGame() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  game.round.part = 2;
  game.round.current = 1;
  game.round.tableau = [
    {
      id: "meldA",
      type: "run",
      slots: [
        { card: card("5", "H"), ownerId: 1, wildAs: null },
        { card: card("6", "H"), ownerId: 1, wildAs: null },
        { card: card("7", "H"), ownerId: 1, wildAs: null },
      ],
    },
  ];
  game.round.hands[1] = [card("7", "S"), card("7", "C")];
  // Deliberately a meld-only obligation (rowObligationCardId left null, as
  // if this were a reclaimed joker from a swap, not an open-row take) --
  // that kind can ONLY be resolved by melding it, never discarded back
  // (§3 decision 17 is row-takes specifically). This is what actually
  // forces the rearrangement path in this test: a row obligation would
  // otherwise just get legally discarded back by the AI's existing
  // fallback, which would resolve pendingObligations without ever
  // exercising rearrangement at all.
  game.round.pendingObligations = ["7S"];
  game.round.rowObligationCardId = null;
  return game;
}

check(
  "AI dissolves its own meld to resolve a stranded obligation no simpler action can place",
  () => {
    const game = freshStrandedGame();
    game.round.comeOut[1] = true;
    CascadeAI.takeTurn(game, { onStateChanged: () => {} });
    if (game.round.pendingObligations.includes("7S"))
      throw new Error(
        "obligation still outstanding -- AI never resolved the 7S obligation",
      );
    const stillHasOriginalRun = game.round.tableau.some(
      (m) => m.id === "meldA",
    );
    if (stillHasOriginalRun)
      throw new Error(
        "original run meldA is still intact -- AI resolved the obligation some other way than dissolving it",
      );
    const sevens = game.round.tableau
      .flatMap((m) => m.slots)
      .filter((s) => s.card.rank === "7");
    if (sevens.length !== 3)
      throw new Error(
        `expected the three 7s (7S,7C,7H) to end up melded together as a set, found ${sevens.length} sevens in any tableau meld`,
      );
  },
);

check(
  "AI never attempts a rearrangement before it has come out (pullFromMeld requires it)",
  () => {
    const game = freshStrandedGame();
    game.round.comeOut[1] = false; // has NOT come out
    // Should not throw, and should not touch the tableau -- falls back to
    // undoing the draw / leaving the row obligation for discard-back,
    // same as before this feature existed.
    CascadeAI.takeTurn(game, { onStateChanged: () => {} });
    const stillHasOriginalRun = game.round.tableau.some(
      (m) => m.id === "meldA",
    );
    if (!stillHasOriginalRun)
      throw new Error(
        "AI dissolved a meld to resolve an obligation before coming out -- rearrangement requires having come out (§2.3)",
      );
  },
);

check(
  "AI declines a joker swap it could never replay, even with a same-meld dissolve sitting right there",
  () => {
    // Table: a diamond run 10D-JD-JOKER(as Q)D, entirely owned by the AI.
    // Hand: only QD -- the exact real card the joker stands for, and
    // nothing else. Swapping it in would strand the reclaimed joker (only
    // 1 card left in hand, no meld possible). Regression coverage for an
    // earlier version of #18 that also let canReplayJokerAfterSwap count a
    // tableau-rearrangement resolution as "safe": that version found this
    // exact meld resolvable by dissolving its own (still pre-swap) cards
    // and relaying them as... the same run, a phantom that vanished the
    // instant the swap for-real removed the joker, permanently stranding
    // it. That broadening was reverted (see ai.ts); this test just pins
    // the plain, always-correct behavior: no resolution, no swap.
    const game = E.newGame("standard", () => 0.1);
    E.startRound(game, () => 0.5);
    game.round.part = 2;
    game.round.current = 1;
    game.round.comeOut[1] = true;
    game.round.tableau = [
      {
        id: "m1",
        type: "run",
        slots: [
          { card: card("10", "D"), ownerId: 1, wildAs: null },
          { card: card("J", "D"), ownerId: 1, wildAs: null },
          { card: card("JOKER", null), ownerId: 1, wildAs: { rank: "Q" } },
        ],
      },
    ];
    game.round.hands[1] = [card("Q", "D")];
    game.round.pendingObligations = [];

    CascadeAI.takeTurn(game, { onStateChanged: () => {} });

    const stillIntact = game.round.tableau.some(
      (m) => m.id === "m1" && m.slots.length === 3,
    );
    if (!stillIntact)
      throw new Error(
        "AI swapped the joker out based on a resolution that wasn't really there, and is now likely stranded",
      );
    if (game.round.pendingObligations.length > 0)
      throw new Error(
        `AI ended the turn with an unresolved obligation: ${JSON.stringify(game.round.pendingObligations)}`,
      );
  },
);

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
