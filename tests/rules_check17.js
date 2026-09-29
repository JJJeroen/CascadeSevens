// Critical-tier: four-of-a-kind is NOT an alternate come-out route (reverted
// 2026-09-29 per a designer/Tommer request relayed by the user -- see
// DESIGN.md §2.4/§3 decision 21). Come-out is score-threshold-only now: a
// four-of-a-kind of low cards (e.g. four 2s = 20 points) is just an ordinary
// 20-point meld toward the 40-point bar, same as any other set or run. This
// file originally covered the opposite (pre-reversal) behavior; updated in
// place rather than deleted, since the "does a 4-card meld get accepted at
// all" coverage (the last check below) is still real and still needed.
import { CascadeEngine } from "../docs/engine.js";
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

function freshGameAtPart2() {
  const game = E.newGame("standard", () => 0.1);
  E.startRound(game, () => 0.5);
  E.turn0Decline(game);
  E.turn0Decline(game);
  game.round.part = 2;
  return game;
}

check(
  "a four-of-a-kind below 40 points does NOT come out on its own (reverted shortcut)",
  () => {
    const game = freshGameAtPart2();
    const r = game.round;
    r.hands[0] = [
      card("2", "H"),
      card("2", "D"),
      card("2", "C"),
      card("2", "S"),
      card("9", "H"),
    ];

    E.layNewMeld(game, [
      { cardId: "2H" },
      { cardId: "2D" },
      { cardId: "2C" },
      { cardId: "2S" },
    ]);

    if (r.comeOutAccum[0] !== 20)
      throw new Error(
        "accum should just be the meld value (20), got " + r.comeOutAccum[0],
      );
    if (r.comeOut[0])
      throw new Error(
        "a 20-point four-of-a-kind should NOT trigger come-out on its own anymore -- only the 40-point threshold does",
      );
  },
);

check(
  "control: an ordinary 3-card set below 40 points does NOT come out",
  () => {
    const game = freshGameAtPart2();
    const r = game.round;
    r.hands[0] = [
      card("2", "H"),
      card("2", "D"),
      card("2", "C"),
      card("9", "H"),
    ];

    E.layNewMeld(game, [{ cardId: "2H" }, { cardId: "2D" }, { cardId: "2C" }]);

    if (r.comeOut[0])
      throw new Error(
        "a 15-point 3-card set alone should not trigger come-out",
      );
    if (r.comeOutAccum[0] !== 15)
      throw new Error(
        "accum should still track the 15 points toward a future 40, got " +
          r.comeOutAccum[0],
      );
  },
);

check(
  "a 4-slot meld (3 real cards + 1 joker) is still valid input to layNewMeld",
  () => {
    const game = freshGameAtPart2();
    const r = game.round;
    // 3 reals of low value + 1 joker: value alone (5+5+5+50=65) crosses 40
    // on its own, so this comes out via the ordinary threshold -- the point
    // here is just confirming a 4-slot (3 real + 1 joker) set is accepted
    // and scored correctly, now that there's no separate "4 slots" shortcut
    // to also exercise.
    r.hands[0] = [
      card("2", "H"),
      card("2", "D"),
      card("2", "C"),
      { id: "JOKER-1", rank: "JOKER", suit: null },
      card("9", "H"),
    ];
    E.layNewMeld(game, [
      { cardId: "2H" },
      { cardId: "2D" },
      { cardId: "2C" },
      { cardId: "JOKER-1", wildAs: { rank: "2" } },
    ]);
    if (r.tableau[0].slots.length !== 4)
      throw new Error("meld should have 4 slots (3 real + 1 joker)");
    if (!r.comeOut[0])
      throw new Error(
        "should have come out via the 40-point threshold (65 points here), confirming 4-slot melds are accepted and scored",
      );
  },
);

console.log(
  failures === 0 ? "\nALL RULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
