// High-tier: property-based fuzz test for tableau rearrangement (DESIGN.md
// §3 decisions 2 & 13). Rearrangement's correctness has rested entirely on
// a handful of example-based scenarios (rules_check11.js) -- this generates
// many random valid pre-rearrange states, applies random move sequences,
// and checks the invariants that must ALWAYS hold regardless of the specific
// moves: card conservation, and that a pre-existing card's owner never
// changes as a side effect of being moved.
//
// This exercises the engine directly and is independent of whether
// docs/ai.js's heuristic ever chooses to rearrange (it doesn't, today).
global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Builds a synthetic (game, currentPlayer) with a random tableau of 1-3
// valid melds (mixed real ownership per slot) plus a random hand for the
// current player, all drawn from a single shared pool of never-repeated
// card ids so the whole state is internally consistent.
function makeRandomState(rng) {
  const used = new Set();
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
  function realCard(rank, suit) {
    const id = `${rank}${suit}`;
    if (used.has(id)) return null;
    used.add(id);
    return { id, rank, suit };
  }
  function randomSet() {
    for (let attempt = 0; attempt < 25; attempt++) {
      const rank = pick(RANKS);
      const count = rng() < 0.5 ? 3 : 4;
      const suits = SUITS.slice().sort(() => rng() - 0.5);
      const cards = [];
      for (const s of suits) {
        const c = realCard(rank, s);
        if (c) cards.push(c);
        if (cards.length === count) break;
      }
      if (cards.length === count) return cards;
      for (const c of cards) used.delete(c.id);
    }
    return null;
  }
  function randomRun() {
    for (let attempt = 0; attempt < 25; attempt++) {
      const suit = pick(SUITS);
      const len = rng() < 0.5 ? 3 : 4;
      const startIdx = Math.floor(rng() * (RANKS.length - len)); // ace-low only, no wraparound
      const cards = [];
      for (let i = 0; i < len; i++) {
        const c = realCard(RANKS[startIdx + i], suit);
        if (c) cards.push(c);
      }
      if (cards.length === len) return cards;
      for (const c of cards) used.delete(c.id);
    }
    return null;
  }

  const tableau = [];
  const meldCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < meldCount; i++) {
    const isRun = rng() < 0.5;
    const cards = isRun ? randomRun() : randomSet();
    if (!cards) continue;
    const slots = cards.map((c) => ({ card: c, ownerId: rng() < 0.5 ? 0 : 1, wildAs: null }));
    tableau.push({ id: `m${i}`, type: isRun ? 'run' : 'set', slots });
  }

  const current = rng() < 0.5 ? 0 : 1;
  const handSize = 2 + Math.floor(rng() * 4); // 2-5 cards
  const hand = [];
  for (let i = 0; i < handSize; i++) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = realCard(pick(RANKS), pick(SUITS));
      if (c) { hand.push(c); break; }
    }
  }

  const game = { scores: [0, 0], gameOver: false, round: {
    tableau, hands: current === 0 ? [hand, []] : [[], hand],
    comeOut: [true, true], part: 2, pendingObligations: [], rowObligationCardId: null,
    rearrange: null, current, log: [],
  } };
  return game;
}

function snapshotCardOwners(game) {
  const r = game.round;
  const owners = {};
  for (const m of r.tableau) for (const s of m.slots) owners[s.card.id] = s.ownerId;
  for (const c of r.hands[r.current]) owners[c.id] = r.current;
  return owners;
}

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

const TRIALS = 3000;
let commits = 0, cancels = 0, blockedCommits = 0;

for (let t = 0; t < TRIALS; t++) {
  const rng = seededRng(t * 7919 + 31);
  const game = makeRandomState(rng);
  const r = game.round;
  const before = snapshotCardOwners(game);
  const beforeCardCount = Object.keys(before).length;

  if (!E.canStartRearrange(game)) { continue; } // e.g. degenerate 0-meld/0-hand draw, just skip
  E.startRearrange(game);

  const moves = 3 + Math.floor(rng() * 6);
  for (let m = 0; m < moves; m++) {
    const state = E.rearrangeState(game);
    const allIds = [...state.handPool, ...state.groups.flatMap((g) => g.cardIds)];
    if (allIds.length === 0) break;
    const cardId = allIds[Math.floor(rng() * allIds.length)];
    // A group that currently holds only this one card would be deleted (now
    // empty) the instant the card is pulled out for the move -- so it's not
    // a valid destination for its OWN sole occupant. A real UI would never
    // offer this as a choice; exclude it here rather than treat the engine's
    // resulting error as a rearrange-invariant failure.
    const currentGroup = state.groups.find((g) => g.cardIds.includes(cardId));
    const selfSingleton = currentGroup && currentGroup.cardIds.length === 1 ? currentGroup.groupId : null;
    const eligibleGroups = state.groups.filter((g) => g.groupId !== selfSingleton);

    const destRoll = rng();
    let destination;
    if (destRoll < 0.3) destination = 'hand';
    else if (destRoll < 0.55 || eligibleGroups.length === 0) destination = 'new';
    else destination = eligibleGroups[Math.floor(rng() * eligibleGroups.length)].groupId;
    E.rearrangeMoveCard(game, cardId, destination);
  }

  const preCommitTableauSnapshot = deepClone(r.tableau);
  const preCommitHandSnapshot = deepClone(r.hands[r.current]);
  const result = E.commitRearrange(game);

  if (result.ok) {
    commits++;
    const after = snapshotCardOwners(game);
    const afterCardCount = Object.keys(after).length;
    if (afterCardCount !== beforeCardCount) {
      console.log(`FAIL trial ${t}: card count changed on commit (${beforeCardCount} -> ${afterCardCount})`);
      process.exit(1);
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        console.log(`FAIL trial ${t}: card ${id} disappeared after a successful commit`);
        process.exit(1);
      }
      if (before[id] !== after[id]) {
        console.log(`FAIL trial ${t}: card ${id} changed owner from ${before[id]} to ${after[id]} on commit -- pre-existing cards must keep their original owner`);
        process.exit(1);
      }
    }
    for (const m of r.tableau) {
      if (m.slots.length < 3) {
        console.log(`FAIL trial ${t}: a committed meld has fewer than 3 slots`);
        process.exit(1);
      }
    }
  } else {
    blockedCommits++;
    if (JSON.stringify(r.tableau) !== JSON.stringify(preCommitTableauSnapshot)) {
      console.log(`FAIL trial ${t}: tableau mutated despite a rejected commit`);
      process.exit(1);
    }
    if (JSON.stringify(r.hands[r.current]) !== JSON.stringify(preCommitHandSnapshot)) {
      console.log(`FAIL trial ${t}: hand mutated despite a rejected commit`);
      process.exit(1);
    }
    E.cancelRearrange(game);
    cancels++;
  }
}

if (commits === 0) {
  console.log('FAIL: no trial ever produced a successful commit -- the harness itself is broken, not just unlucky.');
  process.exit(1);
}
console.log(`OK: ${TRIALS} trials, ${commits} committed (invariants held), ${blockedCommits} correctly rejected (state untouched).`);
