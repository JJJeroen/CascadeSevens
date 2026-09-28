// High-tier: property-based fuzz test for the AI's obligation-resolution-
// via-rearrangement fallback (#18, tryResolveObligationViaRearrange in
// ai.ts). Organic AI-vs-AI self-play essentially never reaches this path
// -- the AI's own pre-checks (canResolvePickup, canReplayJokerAfterSwap)
// already guarantee it never takes on an obligation it can't resolve by
// simpler means, so the fallback is a safety net that's almost never
// actually needed in practice. An earlier version tried making the AI
// broaden those pre-checks to treat a rearrangement-only resolution as
// "safe to take" specifically so the stress simulation would exercise this
// path organically -- that produced a real infinite cycle (two AI players
// endlessly reshuffling the same ~7 cards between two melds, caught by
// sim_stress.js) and was reverted. This file exercises the fallback
// directly and repeatedly instead, the same way sim_rearrange.js already
// does for the engine's tableau-rearrange session independent of whether
// docs/ai.js's heuristic ever chooses to use it organically.
//
// Each trial builds a genuinely random instance of the one shape this
// fallback exists for: a run entirely owned by the current player, and a
// hand holding an obligated card that can only be completed into a set by
// dissolving that run to free its matching-rank card. No direct add (wrong
// suit for the run) or lay-from-hand-alone (only 2 of 3 needed cards)
// resolves it -- only the rearrangement fallback does.
import { CascadeAI } from "../docs/ai.js";

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const SUITS = ["S", "H", "D", "C"];
const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

function card(rank, suit) {
  return { id: `${rank}${suit}`, rank, suit };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// One random instance of the target shape. `useTop` picks whether the
// obligated rank is the run's high or low end -- either way the meld's
// full dissolve is required (a single-card pull down to 2 is illegal), so
// this doesn't change which mechanism resolves it, just exercises both
// ends across trials.
function makeStrandedObligationState(rng, current) {
  const runLen = 3;
  const suit = pick(rng, SUITS);
  const startIdx = Math.floor(rng() * (RANKS.length - runLen));
  const runRanks = RANKS.slice(startIdx, startIdx + runLen);
  const useTop = rng() < 0.5;
  const targetRank = useTop ? runRanks[runLen - 1] : runRanks[0];
  const otherSuits = SUITS.filter((s) => s !== suit);
  const [suitA, suitB] = [otherSuits[0], otherSuits[1]];

  const meldId = `m-run-${startIdx}-${suit}`;
  const tableau = [
    {
      id: meldId,
      type: "run",
      slots: runRanks.map((r) => ({
        card: card(r, suit),
        ownerId: current,
        wildAs: null,
      })),
    },
  ];
  const obligatedCard = card(targetRank, suitA);
  const fillerCard = card(targetRank, suitB);
  const hand = [obligatedCard, fillerCard];

  const game = {
    scores: [0, 0],
    gameOver: false,
    round: {
      openRow: [],
      closedPile: [],
      tableau,
      hands: current === 0 ? [hand, []] : [[], hand],
      comeOut: current === 0 ? [true, false] : [false, true],
      part: 2,
      current,
      pendingObligations: [obligatedCard.id],
      rowObligationCardId: null, // meld-only obligation -- not discard-eligible, forces a real meld
      rearrange: null,
      lastDraw: null,
      log: [],
    },
  };
  return { game, meldId, obligatedCard, targetRank };
}

const TRIALS = 1000;
let resolvedViaDissolve = 0;

for (let t = 0; t < TRIALS; t++) {
  const rng = seededRng(t * 7919 + 12321);
  const current = t % 2;
  const { game, meldId, obligatedCard, targetRank } =
    makeStrandedObligationState(rng, current);

  CascadeAI.takeTurn(game, { onStateChanged: () => {} });

  const r = game.round;
  if (r.pendingObligations.includes(obligatedCard.id)) {
    console.log(
      `FAIL trial ${t}: obligation ${obligatedCard.id} still outstanding -- AI never resolved it`,
    );
    process.exit(1);
  }
  const originalMeldStillIntact = r.tableau.some(
    (m) => m.id === meldId && m.slots.length === 3,
  );
  if (originalMeldStillIntact) {
    console.log(
      `FAIL trial ${t}: original meld ${meldId} is still intact -- the AI resolved the obligation some other way than dissolving it, which shouldn't be possible in this fixture`,
    );
    process.exit(1);
  }
  const matchingRankSlots = r.tableau
    .flatMap((m) => m.slots)
    .filter((s) => s.card.rank === targetRank);
  if (matchingRankSlots.length !== 3) {
    console.log(
      `FAIL trial ${t}: expected the 3 ${targetRank}s to end up melded together as a set, found ${matchingRankSlots.length}`,
    );
    process.exit(1);
  }
  resolvedViaDissolve++;
}

if (resolvedViaDissolve !== TRIALS) {
  console.log(
    `FAIL: only ${resolvedViaDissolve}/${TRIALS} trials actually exercised the dissolve -- the fixture itself may not reliably force the fallback path.`,
  );
  process.exit(1);
}
console.log(
  `OK: ${TRIALS} trials, AI dissolved a stranding meld to resolve the obligation every time (both players, both run ends).`,
);
