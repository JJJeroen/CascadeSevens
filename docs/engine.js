// Cascade Sevens — pure rules engine (framework-agnostic), per DESIGN.md.
// No DOM access here. State is plain data; every mutation goes through an
// exported function so app.js/ai.js never poke internals directly.

const CascadeEngine = (() => {
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function pointValue(rank) {
    if (rank === 'JOKER') return 50;
    if (rank === 'A') return 25;
    if (['10', 'J', 'Q', 'K'].includes(rank)) return 10;
    return 5;
  }

  function buildDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (const r of RANKS) deck.push({ id: `${r}${s}`, rank: r, suit: s });
    }
    deck.push({ id: 'JOKER-1', rank: 'JOKER', suit: null });
    deck.push({ id: 'JOKER-2', rank: 'JOKER', suit: null });
    return deck;
  }

  function shuffle(deck, rng = Math.random) {
    const a = deck.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- Game/round setup ---------------------------------------------------

  function newGame(mode = 'standard') {
    return {
      mode, // 'standard' (>1000) or 'quick' (>300)
      threshold: mode === 'quick' ? 300 : 1000,
      scores: [0, 0],
      roundNumber: 0,
      gameOver: false,
      winner: null,
      round: null,
    };
  }

  function startRound(game, rng = Math.random) {
    const deck = shuffle(buildDeck(), rng);
    const hands = [deck.slice(0, 7), deck.slice(7, 14)];
    const rest = deck.slice(14);
    const openRow = [rest.pop()];
    game.roundNumber += 1;
    game.round = {
      closedPile: rest,
      openRow, // index 0 = oldest/bottom, last = newest/top
      hands,
      tableau: [], // [{id, type:'set'|'run', slots:[{card, ownerId, wildAs}]}]
      comeOut: [false, false],
      current: 0, // player index whose turn it is
      part: 'turn0', // 'turn0' | 1 | 2 | 3
      turn0: { stage: 'p1first', resolved: false }, // stage: p1first -> p2second -> p1followup -> resolved
      pendingObligations: [], // card ids that must appear in a meld action before Part 3
      lastDraw: null, // { source: 'row', takenCards, priorObligations } — undoable until any other Part 2 action happens
      rowDrawsThisPart1: 0, // repeat open-row takes within Part 1 (§2.3, revised 2026-07-26); resets each turn
      comeOutAccum: [0, 0], // per-player running total toward the 40-point come-out bar (§2.4) — persists across turns until crossed, confirmed against the designer 2026-07-26
      comeOutMetThisTurn: false,
      log: [],
      ended: false,
      endReason: null, // 'handout' | 'pile-empty'
      roundWinner: null,
    };
    logMsg(game, `Round ${game.roundNumber} dealt. Mode: ${game.mode}.`);
    return game;
  }

  function logMsg(game, msg) {
    game.round.log.push(msg);
  }

  function other(p) {
    return p === 0 ? 1 : 0;
  }

  function findCard(hand, cardId) {
    return hand.findIndex((c) => c.id === cardId);
  }

  // --- Turn 0: starter-card exchange (§2.6) -------------------------------
  // Asymmetric (revised 2026-07-26): P1 is offered first. If P1 takes it,
  // Turn 0 ends immediately — no follow-up for P2. If P1 declines, P2 is
  // offered; if P2 also declines, Turn 0 never triggers at all. If P2
  // takes it, P1 gets one consolation follow-up look at the newly-placed
  // card, and Turn 0 ends after that regardless of P1's answer.

  // Who is currently being asked to accept/decline the Turn 0 exchange
  // (null once Turn 0 has fully resolved).
  function turn0CurrentAskee(game) {
    const r = game.round;
    if (r.part !== 'turn0' || r.turn0.resolved) return null;
    const stage = r.turn0.stage;
    if (stage === 'p1first' || stage === 'p1followup') return 0;
    if (stage === 'p2second') return 1;
    return null;
  }

  function turn0Decline(game) {
    const t = game.round.turn0;
    if (t.resolved) throw new Error('Turn 0 already resolved.');
    if (t.stage === 'p1first') {
      t.stage = 'p2second';
      return;
    }
    if (t.stage === 'p2second') {
      t.resolved = true;
      logMsg(game, 'Both players declined the Turn 0 exchange.');
      beginNormalRotation(game);
      return;
    }
    // t.stage === 'p1followup': P1 declined the consolation look.
    t.resolved = true;
    logMsg(game, 'Turn 0 exchange ends after one swap.');
    beginNormalRotation(game);
  }

  function turn0Accept(game, replacementCardId) {
    const r = game.round;
    const t = r.turn0;
    const takerIdx = turn0CurrentAskee(game);
    if (takerIdx === null) throw new Error('Turn 0 closed.');
    const hand = r.hands[takerIdx];
    const takenCard = r.openRow.pop();
    hand.push(takenCard);
    const ci = findCard(hand, replacementCardId);
    if (ci === -1) throw new Error('Replacement card not in hand.');
    const [placed] = hand.splice(ci, 1);
    r.openRow.push(placed);
    logMsg(game, `Player ${takerIdx + 1} took the starter card and swapped in ${placed.rank}${placed.suit || ''}.`);

    if (t.stage === 'p1first') {
      t.resolved = true; // P1 taking it immediately ends Turn 0 — no follow-up for P2.
      beginNormalRotation(game);
    } else if (t.stage === 'p2second') {
      t.stage = 'p1followup'; // P1 passed on it, so P1 gets one consolation look now.
    } else {
      // t.stage === 'p1followup'
      t.resolved = true;
      beginNormalRotation(game);
    }
  }

  function beginNormalRotation(game) {
    const r = game.round;
    r.part = 1;
    r.current = 0;
    logMsg(game, `Turn 0 resolved. Player 1's turn begins.`);
  }

  // --- Part 1: draw ---------------------------------------------------------
  // Revised 2026-07-26: taking from the open row may be repeated any number
  // of times within Part 1 — it no longer ends Part 1 by itself. The first
  // row-take (in a Part 1 that hasn't drawn yet) forecloses the closed pile
  // for the rest of this turn; only the bottom card of the MOST RECENT
  // row-take is a binding "must meld" obligation — an earlier row-take's
  // obligation is superseded, not accumulated, once another row-take
  // happens. The player explicitly ends Part 1 via finishDrawing() once
  // they're done (only reachable after at least one draw).

  function canDrawFromRow(game) {
    const r = game.round;
    return r.part === 1 && r.openRow.length > 0;
  }

  function canDrawFromClosedPile(game) {
    const r = game.round;
    return r.part === 1 && r.rowDrawsThisPart1 === 0;
  }

  function drawFromClosedPile(game) {
    const r = game.round;
    if (!canDrawFromClosedPile(game)) {
      throw new Error(
        r.part !== 1
          ? 'Not in Part 1.'
          : 'Already took from the open row this turn — the closed pile is no longer available.'
      );
    }
    if (r.closedPile.length === 0) {
      endRoundPileEmpty(game);
      return;
    }
    const card = r.closedPile.pop();
    r.hands[r.current].push(card);
    logMsg(game, `Player ${r.current + 1} drew from the closed pile.`);
    r.part = 2;
    r.lastDraw = null;
  }

  function drawFromOpenRow(game, cardId) {
    const r = game.round;
    if (!canDrawFromRow(game)) throw new Error('Not in Part 1, or the open row is empty.');
    const idx = r.openRow.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error('Card not in open row.');
    const taken = r.openRow.splice(idx); // this card + everything after it
    r.hands[r.current].push(...taken);
    const bottomCard = taken[0];
    const priorObligations = r.pendingObligations.slice();
    r.pendingObligations = [bottomCard.id]; // supersedes any earlier row-take's obligation this Part 1
    r.rowDrawsThisPart1 += 1;
    logMsg(
      game,
      `Player ${r.current + 1} took ${taken.length} card(s) from the open row (must meld ${bottomCard.rank}${bottomCard.suit || ''}).`
    );
    r.lastDraw = { source: 'row', takenCards: taken.slice(), priorObligations };
  }

  // The deliberate step from Part 1 into Part 2, once the player is done
  // drawing (possible only after at least one open-row take — a closed-pile
  // draw already transitions straight to Part 2 on its own).
  function canFinishDrawing(game) {
    const r = game.round;
    return r.part === 1 && r.rowDrawsThisPart1 > 0;
  }

  function finishDrawing(game) {
    const r = game.round;
    if (!canFinishDrawing(game)) throw new Error('Nothing to finish — draw first.');
    r.part = 2;
    r.lastDraw = null;
  }

  // Taking from the open row is voluntary in principle (§2.5) — a player
  // shouldn't take a card they can't meld — but nothing stops a human from
  // doing it anyway and then discovering they're stuck. This is the escape
  // hatch: undo the most recent row-take, provided nothing else has
  // happened since (another row-take, any Part 2 action, or finishDrawing
  // all close the window by clearing lastDraw).
  function canUndoDraw(game) {
    const r = game.round;
    return !!r.lastDraw && r.lastDraw.source === 'row';
  }

  function undoDraw(game) {
    const r = game.round;
    if (!canUndoDraw(game)) throw new Error('Nothing to undo.');
    const { takenCards, priorObligations } = r.lastDraw;
    const hand = r.hands[r.current];
    for (const c of takenCards) {
      if (findCard(hand, c.id) === -1) throw new Error('Cannot undo — hand has changed since the draw.');
    }
    for (const c of takenCards) {
      hand.splice(findCard(hand, c.id), 1);
    }
    r.openRow.push(...takenCards);
    r.pendingObligations = priorObligations;
    r.rowDrawsThisPart1 -= 1;
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} undid taking from the open row.`);
  }

  // --- Meld validation ------------------------------------------------------

  function rankValue(rank, aceHigh) {
    if (rank === 'A') return aceHigh ? 14 : 1;
    const i = RANKS.indexOf(rank);
    return i + 1; // 2->2 ... K->13, offset later
  }

  function orderedRankValue(rank, aceHigh) {
    const map = { A: aceHigh ? 14 : 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
    return map[rank];
  }

  function rankNameForValue(value, aceHigh) {
    if (value === (aceHigh ? 14 : 1)) return 'A';
    const names = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
    return names[value] || null;
  }

  // Given a fixed set of selected hand cards (by id), figure out on its own
  // whether ANY valid meld can be formed — including every way a joker
  // could stand in — rather than making the caller pre-guess a specific
  // rank/suit assignment. Sets have no real ambiguity (a joker in a set
  // always just takes the group's shared rank); runs do, since a joker can
  // fill any internal gap or extend either end — solved directly rather
  // than brute-forcing every permutation.
  function autoResolveMeld(hand, cardIds) {
    if (cardIds.length < 3) return { ok: false, error: 'A meld needs at least 3 cards.' };
    const cards = cardIds.map((id) => hand.find((h) => h.id === id));
    if (cards.some((c) => !c)) return { ok: false, error: 'Selected card not in hand.' };
    const jokers = cards.filter((c) => c.rank === 'JOKER');
    const reals = cards.filter((c) => c.rank !== 'JOKER');
    if (reals.length === 0) return { ok: false, error: 'A meld needs at least one real (non-joker) card.' };

    // Try as a set: every real card must already share one rank.
    if (reals.every((c) => c.rank === reals[0].rank)) {
      const rank = reals[0].rank;
      const slots = [
        ...reals.map((c) => ({ cardId: c.id })),
        ...jokers.map((c) => ({ cardId: c.id, wildAs: { rank } })),
      ];
      return { ok: true, type: 'set', slots };
    }

    // Try as a run: every real card must share one suit.
    if (reals.every((c) => c.suit === reals[0].suit)) {
      const suit = reals[0].suit;
      for (const aceHigh of [false, true]) {
        const values = reals.map((c) => orderedRankValue(c.rank, aceHigh));
        if (new Set(values).size !== values.length) continue; // can't happen with a real deck, but be safe
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spanReals = max - min + 1;
        const internalGaps = spanReals - reals.length;
        const totalSize = reals.length + jokers.length;
        if (internalGaps > jokers.length || totalSize > 13) continue;

        // Fill internal gaps first, then extend outward with whatever's left.
        const filled = new Set(values);
        let spare = jokers.length - internalGaps;
        for (let v = min; v <= max; v++) filled.add(v);
        let lo = min, hi = max;
        while (spare > 0) {
          if (lo > 1) { lo -= 1; filled.add(lo); spare -= 1; }
          else if (hi < 13) { hi += 1; filled.add(hi); spare -= 1; }
          else break;
        }
        if (spare > 0) continue; // ran out of room (shouldn't happen given the totalSize<=13 check)

        const jokerValues = [...filled].filter((v) => !values.includes(v)).sort((a, b) => a - b);
        // tryAsRun's sequence check is order-dependent (array order = the
        // run's left-to-right sequence) — reals-then-jokers concatenation
        // order is essentially never already sorted, so this must be
        // explicitly ordered by resolved value before returning.
        const unordered = [
          ...reals.map((c) => ({ cardId: c.id, value: orderedRankValue(c.rank, aceHigh) })),
          ...jokers.map((c, i) => ({ cardId: c.id, wildAs: { rank: rankNameForValue(jokerValues[i], aceHigh) }, value: jokerValues[i] })),
        ];
        unordered.sort((a, b) => a.value - b.value);
        const slots = unordered.map(({ cardId, wildAs }) => (wildAs ? { cardId, wildAs } : { cardId }));
        return { ok: true, type: 'run', slots };
      }
    }

    return { ok: false, error: 'No valid set or run is possible with the selected cards.' };
  }

  // slots: [{cardId, wildAs?: {rank, suit?}}] pulled from hand, in the order
  // the player wants them (for runs, order defines the sequence direction).
  function validateNewMeldSelection(hand, slots) {
    if (slots.length < 3) return { ok: false, error: 'A meld needs at least 3 cards.' };
    const cards = slots.map((s) => {
      const c = hand.find((h) => h.id === s.cardId);
      if (!c) throw new Error('Selected card not in hand.');
      return { real: c, wildAs: s.wildAs || null };
    });
    const setResult = tryAsSet(cards);
    if (setResult.ok) return setResult;
    const runResult = tryAsRun(cards);
    if (runResult.ok) return runResult;
    return { ok: false, error: setResult.error || runResult.error || 'Not a valid set or run.' };
  }

  function tryAsSet(cards) {
    const nonJokers = cards.filter((c) => c.real.rank !== 'JOKER');
    if (nonJokers.length === 0) return { ok: false, error: 'A set needs at least one real card.' };
    const rank = nonJokers[0].real.rank;
    for (const c of nonJokers) {
      if (c.real.rank !== rank) return { ok: false, error: 'Not all cards share a rank.' };
    }
    for (const c of cards) {
      if (c.real.rank === 'JOKER' && c.wildAs && c.wildAs.rank !== rank) {
        return { ok: false, error: 'Joker must stand in for the set rank.' };
      }
    }
    return { ok: true, type: 'set', rank, isFourOfAKind: cards.length === 4 };
  }

  function tryAsRun(cards) {
    const nonJokers = cards.filter((c) => c.real.rank !== 'JOKER');
    if (nonJokers.length === 0) return { ok: false, error: 'A run needs at least one real card.' };
    const suit = nonJokers[0].real.suit;
    for (const c of nonJokers) {
      if (c.real.suit !== suit) return { ok: false, error: 'Not all cards share a suit.' };
    }
    // Try both ace-low and ace-high interpretations, sequence must match card order given.
    for (const aceHigh of [false, true]) {
      let ok = true;
      let prev = null;
      const values = [];
      for (const c of cards) {
        let rank;
        if (c.real.rank === 'JOKER') {
          // A joker's suit in a run is always the run's own suit — it's
          // implied, not something the caller needs to (mis)supply. Only
          // the rank is meaningful, since that's what fixes its position
          // in the sequence.
          if (!c.wildAs || !c.wildAs.rank) { ok = false; break; }
          rank = c.wildAs.rank;
        } else {
          rank = c.real.rank;
        }
        if (rank === 'A' && aceHigh === false && cards.some((x) => (x.wildAs ? x.wildAs.rank : x.real.rank) === 'K')) {
          // ace-low run can't also contain K (would need wraparound) — handled by value check below anyway
        }
        const v = orderedRankValue(rank, aceHigh);
        values.push(v);
      }
      if (!ok) continue;
      let sequential = true;
      for (let i = 1; i < values.length; i++) {
        if (values[i] !== values[i - 1] + 1) { sequential = false; break; }
      }
      if (sequential && new Set(values).size === values.length) {
        return { ok: true, type: 'run', suit, aceHigh };
      }
    }
    return { ok: false, error: 'Cards are not a valid ascending sequence, same suit (no wraparound).' };
  }

  function meldValueFromSlots(slots) {
    return slots.reduce((sum, s) => sum + pointValue(s.card.rank), 0);
  }

  // --- Part 2: meld actions ---------------------------------------------------

  function hasComeOut(game) {
    return game.round.comeOut[game.round.current];
  }

  function layNewMeld(game, cardSelections) {
    // cardSelections: [{cardId, wildAs?}]
    const r = game.round;
    if (r.part !== 2) throw new Error('Not in Part 2.');
    const hand = r.hands[r.current];
    if (cardSelections.length === hand.length) {
      throw new Error('Cannot use your entire hand in a meld — you must keep at least one card to discard.');
    }
    const result = validateNewMeldSelection(hand, cardSelections);
    if (!result.ok) throw new Error(result.error);

    const slots = cardSelections.map((s) => {
      const ci = findCard(hand, s.cardId);
      const [card] = hand.splice(ci, 1);
      // Only rank is ever meaningful (see meldSuit) — normalize away any
      // suit the caller may have supplied so it can't end up in a display
      // label implying the joker impersonates one specific existing card.
      const wildAs = card.rank === 'JOKER' && s.wildAs ? { rank: s.wildAs.rank } : null;
      return { card, ownerId: r.current, wildAs };
    });
    const meld = { id: `m${r.tableau.length}-${Date.now()}`, type: result.type, slots };
    r.tableau.push(meld);
    r.lastDraw = null; // an action happened this turn — the pickup can no longer be undone

    // clear pending obligations satisfied by this meld
    clearObligations(r, slots.map((s) => s.card.id));

    const value = meldValueFromSlots(slots);
    if (!r.comeOut[r.current]) {
      r.comeOutAccum[r.current] += value;
      const fourOfAKind = result.type === 'set' && result.isFourOfAKind;
      if (r.comeOutAccum[r.current] >= 40 || fourOfAKind) {
        r.comeOut[r.current] = true;
        logMsg(game, `Player ${r.current + 1} has come out!`);
      }
    }
    logMsg(game, `Player ${r.current + 1} laid a new ${result.type} (${slots.map((s) => s.card.rank).join(',')}).`);
    return meld;
  }

  function clearObligations(r, cardIds) {
    r.pendingObligations = r.pendingObligations.filter((id) => !cardIds.includes(id));
  }

  function addToMeld(game, meldId, cardId, wildAs) {
    const r = game.round;
    if (r.part !== 2) throw new Error('Not in Part 2.');
    if (!r.comeOut[r.current]) throw new Error('Must come out before adding to any meld.');
    const hand = r.hands[r.current];
    if (hand.length <= 1) {
      throw new Error('Cannot add your last card in hand to a meld — you must keep at least one card to discard.');
    }
    const ci = findCard(hand, cardId);
    if (ci === -1) throw new Error('Card not in hand.');
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld) throw new Error('Meld not found.');
    const card = hand[ci];

    if (meld.type === 'set') {
      const rank = meld.slots.find((s) => s.card.rank !== 'JOKER').card.rank;
      const cardRank = card.rank === 'JOKER' ? (wildAs && wildAs.rank) : card.rank;
      if (cardRank !== rank) throw new Error('Card does not match the set rank.');
    } else {
      // A joker's suit in a run is always the run's own suit (implied, not
      // something the caller needs to supply) — only rank is meaningful.
      const suit = meldSuit(meld);
      const seq = meldRunValues(meld);
      const cardSuit = card.rank === 'JOKER' ? suit : card.suit;
      const cardRank = card.rank === 'JOKER' ? (wildAs && wildAs.rank) : card.rank;
      if (cardSuit !== suit) throw new Error('Card does not match the run suit.');
      const v = orderedRankValue(cardRank, seq.aceHigh);
      const extendsLow = v === seq.min - 1 && v >= 1;
      const extendsHigh = v === seq.max + 1 && v <= 13;
      if (!extendsLow && !extendsHigh) throw new Error('Card does not extend either end of the run.');
    }

    hand.splice(ci, 1);
    meld.slots.push({ card, ownerId: r.current, wildAs: card.rank === 'JOKER' ? { rank: wildAs.rank } : null });
    clearObligations(r, [card.id]);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} added ${card.rank}${card.suit || ''} to a ${meld.type}.`);
  }

  // A meld always has at least one real (non-joker) card — enforced at
  // creation (tryAsSet/tryAsRun both reject an all-joker selection) — so
  // this is always resolvable for a valid run.
  function meldSuit(meld) {
    const real = meld.slots.find((s) => s.card.rank !== 'JOKER');
    return real ? real.card.suit : null;
  }

  function meldRunValues(meld) {
    const values = meld.slots.map((s) => {
      const rank = s.card.rank === 'JOKER' ? s.wildAs.rank : s.card.rank;
      return orderedRankValue(rank, false);
    });
    // pick interpretation consistent with the meld: recompute using both, take the one that's sequential
    for (const aceHigh of [false, true]) {
      const vs = meld.slots.map((s) => {
        const rank = s.card.rank === 'JOKER' ? s.wildAs.rank : s.card.rank;
        return orderedRankValue(rank, aceHigh);
      });
      const sorted = vs.slice().sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) ok = false;
      if (ok) return { min: sorted[0], max: sorted[sorted.length - 1], aceHigh };
    }
    const sorted = values.slice().sort((a, b) => a - b);
    return { min: sorted[0], max: sorted[sorted.length - 1], aceHigh: false };
  }

  // For a single card (possibly a joker) being added to an existing meld:
  // no ambiguity for a set (always the meld's rank); for a run, try
  // extending low then high. Returns null if a joker has no legal spot.
  function autoResolveAddToMeld(meld, card) {
    if (card.rank !== 'JOKER') return { wildAs: undefined };
    if (meld.type === 'set') {
      const rank = meld.slots.find((s) => s.card.rank !== 'JOKER').card.rank;
      return { wildAs: { rank } };
    }
    const seq = meldRunValues(meld);
    for (const v of [seq.min - 1, seq.max + 1]) {
      if (v < 1 || v > 13) continue;
      const rank = rankNameForValue(v, seq.aceHigh);
      if (rank) return { wildAs: { rank } };
    }
    return null;
  }

  function swapJoker(game, meldId, jokerCardId, replacementCardId) {
    const r = game.round;
    if (r.part !== 2) throw new Error('Not in Part 2.');
    if (!r.comeOut[r.current]) throw new Error('Must come out before swapping a joker.');
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld) throw new Error('Meld not found.');
    const slotIdx = meld.slots.findIndex((s) => s.card.id === jokerCardId && s.card.rank === 'JOKER');
    if (slotIdx === -1) throw new Error('Joker not found in that meld.');
    const slot = meld.slots[slotIdx];
    const hand = r.hands[r.current];
    const ci = findCard(hand, replacementCardId);
    if (ci === -1) throw new Error('Replacement card not in hand.');
    const replacement = hand[ci];
    if (meld.type === 'set') {
      if (replacement.rank !== slot.wildAs.rank) throw new Error('Replacement rank does not match.');
    } else {
      if (replacement.rank !== slot.wildAs.rank || replacement.suit !== meldSuit(meld)) {
        throw new Error('Replacement card does not match what the joker represents.');
      }
    }
    hand.splice(ci, 1);
    meld.slots[slotIdx] = { card: replacement, ownerId: r.current, wildAs: null };
    hand.push(slot.card); // joker returns to hand
    r.pendingObligations.push(slot.card.id); // must be replayed into a meld this turn
    clearObligations(r, [replacement.id]);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} swapped a joker for ${replacement.rank}${replacement.suit || ''}.`);
  }

  // Validates a set of already-materialized meld slots ({card, wildAs}) —
  // used to check what's left behind in a meld after pulling a card out.
  function validateMeldSlots(slots) {
    const cards = slots.map((s) => ({ real: s.card, wildAs: s.wildAs }));
    const setResult = tryAsSet(cards);
    if (setResult.ok) return setResult;
    return tryAsRun(cards);
  }

  // Tableau rearrangement (§2.3, §3 decision 2): pull one or more cards
  // back out of any meld — own or opponent's — into hand, atomically (all
  // named cards leave together). What's left behind must either be empty
  // (meld fully dissolves) or still a valid 3+-card set/run. This has to
  // be atomic, not one-card-at-a-time: shrinking a meld to 1 or 2 cards is
  // always illegal, so a single-card-only API could never fully dissolve
  // *any* meld (every path from 3+ down to 0 passes through 1 or 2).
  // Re-laying the pulled cards is just a normal layNewMeld/addToMeld call
  // afterward, since they're sitting in hand like any other card.
  function pullFromMeld(game, meldId, cardIds) {
    const r = game.round;
    if (r.part !== 2) throw new Error('Not in Part 2.');
    if (!r.comeOut[r.current]) throw new Error('Must come out before rearranging the tableau.');
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld) throw new Error('Meld not found.');
    const ids = Array.isArray(cardIds) ? cardIds : [cardIds];
    if (ids.length === 0) throw new Error('No cards specified to pull.');
    const pulled = [];
    const remaining = [];
    for (const slot of meld.slots) {
      if (ids.includes(slot.card.id)) pulled.push(slot);
      else remaining.push(slot);
    }
    if (pulled.length !== ids.length) throw new Error('Some cards were not found in that meld.');
    // Confirmed against the designer (2026-07-27): a player may only pull
    // cards THEY themselves currently own (i.e. placed most recently, per
    // §2.8's ownership-follows-placement rule) — not cards credited to the
    // opponent, even though either player can freely ADD to any meld.
    const notMine = pulled.find((slot) => slot.ownerId !== r.current);
    if (notMine) {
      throw new Error(
        `Can't pull ${notMine.card.rank}${notMine.card.suit || ''} — it's credited to the other player, and you can only pull back cards you placed yourself.`
      );
    }
    if (remaining.length > 0) {
      const check = remaining.length >= 3 ? validateMeldSlots(remaining) : { ok: false };
      if (!check.ok) throw new Error('Pulling those cards would leave an invalid meld behind (fewer than 3 cards, or a broken run).');
    }
    meld.slots = remaining;
    if (meld.slots.length === 0) {
      r.tableau = r.tableau.filter((m) => m.id !== meldId);
    }
    for (const slot of pulled) r.hands[r.current].push(slot.card);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} pulled ${pulled.length} card(s) back from the tableau.`);
  }

  // --- Part 3: discard --------------------------------------------------------

  function canProceedToDiscard(game) {
    return game.round.part === 2 && game.round.pendingObligations.length === 0;
  }

  function discard(game, cardId) {
    const r = game.round;
    if (r.part !== 2) throw new Error('Not in Part 2.');
    if (r.pendingObligations.length > 0) throw new Error('Outstanding cards must be melded first.');
    const hand = r.hands[r.current];
    const ci = findCard(hand, cardId);
    if (ci === -1) throw new Error('Card not in hand.');
    const [card] = hand.splice(ci, 1);
    r.openRow.push(card);
    logMsg(game, `Player ${r.current + 1} discarded ${card.rank}${card.suit || ''}.`);
    if (hand.length === 0) {
      endRoundHandOut(game, r.current);
      return;
    }
    advanceTurn(game);
  }

  function advanceTurn(game) {
    const r = game.round;
    r.current = other(r.current);
    r.part = 1;
    r.lastDraw = null;
    r.rowDrawsThisPart1 = 0;
  }

  // --- Round / game end ---------------------------------------------------

  function endRoundHandOut(game, winnerIdx) {
    const r = game.round;
    r.ended = true;
    r.endReason = 'handout';
    r.roundWinner = winnerIdx;
    scoreRound(game);
  }

  function endRoundPileEmpty(game) {
    const r = game.round;
    r.ended = true;
    r.endReason = 'pile-empty';
    r.roundWinner = null;
    scoreRound(game);
  }

  function scoreRound(game) {
    const r = game.round;
    const roundScores = [0, 0];
    for (const meld of r.tableau) {
      for (const slot of meld.slots) {
        roundScores[slot.ownerId] += pointValue(slot.card.rank);
      }
    }
    if (r.roundWinner !== null) {
      roundScores[r.roundWinner] += 50;
      const loser = other(r.roundWinner);
      const penalty = r.hands[loser].reduce((s, c) => s + pointValue(c.rank), 0);
      roundScores[loser] -= penalty;
    } else {
      // pile-empty: both players penalized for their own remaining hand
      for (let p = 0; p < 2; p++) {
        const penalty = r.hands[p].reduce((s, c) => s + pointValue(c.rank), 0);
        roundScores[p] -= penalty;
      }
    }
    game.scores[0] += roundScores[0];
    game.scores[1] += roundScores[1];
    r.roundScores = roundScores;
    logMsg(
      game,
      `Round over (${r.endReason}). Round scores: P1 ${roundScores[0]}, P2 ${roundScores[1]}. Totals: P1 ${game.scores[0]}, P2 ${game.scores[1]}.`
    );
    checkGameEnd(game);
  }

  // §2.8 "app behavior": live running score, not just a round-end lump sum.
  // Meld points already on the table score for the round in progress even
  // before it ends, so the UI can show an always-current total.
  function roundMeldPointsSoFar(game, playerIdx) {
    let total = 0;
    for (const meld of game.round.tableau) {
      for (const slot of meld.slots) {
        if (slot.ownerId === playerIdx) total += pointValue(slot.card.rank);
      }
    }
    return total;
  }

  function liveScore(game, playerIdx) {
    return game.scores[playerIdx] + roundMeldPointsSoFar(game, playerIdx);
  }

  function checkGameEnd(game) {
    const [a, b] = game.scores;
    if (a > game.threshold && a > b) {
      game.gameOver = true;
      game.winner = 0;
    } else if (b > game.threshold && b > a) {
      game.gameOver = true;
      game.winner = 1;
    }
  }

  return {
    pointValue,
    buildDeck,
    shuffle,
    newGame,
    startRound,
    other,
    turn0CurrentAskee,
    turn0Decline,
    turn0Accept,
    canDrawFromRow,
    canDrawFromClosedPile,
    drawFromClosedPile,
    drawFromOpenRow,
    canFinishDrawing,
    finishDrawing,
    canUndoDraw,
    undoDraw,
    validateNewMeldSelection,
    autoResolveMeld,
    hasComeOut,
    layNewMeld,
    addToMeld,
    swapJoker,
    pullFromMeld,
    canProceedToDiscard,
    discard,
    orderedRankValue,
    meldRunValues,
    meldSuit,
    autoResolveAddToMeld,
    roundMeldPointsSoFar,
    liveScore,
  };
})();

if (typeof window !== 'undefined') window.CascadeEngine = CascadeEngine;
