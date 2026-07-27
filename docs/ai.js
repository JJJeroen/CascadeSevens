// Cascade Sevens — simple heuristic AI (player index 1). Not the phase-2
// "real" AI from DESIGN.md §5.2 — just enough to hotseat-test the rules
// against something. Calls the same engine API a human UI would call.

const CascadeAI = (() => {
  const E = () => window.CascadeEngine;

  function rankGroups(hand) {
    const groups = {};
    for (const c of hand) {
      if (c.rank === 'JOKER') continue;
      (groups[c.rank] = groups[c.rank] || []).push(c);
    }
    return groups;
  }

  function suitGroups(hand) {
    const groups = {};
    for (const c of hand) {
      if (c.rank === 'JOKER') continue;
      (groups[c.suit] = groups[c.suit] || []).push(c);
    }
    return groups;
  }

  function findCandidateSets(hand, jokersLeft) {
    const out = [];
    const groups = rankGroups(hand);
    for (const rank of Object.keys(groups)) {
      const cards = groups[rank];
      if (cards.length >= 3) {
        const slots = cards.slice(0, 4).map((c) => ({ cardId: c.id }));
        out.push({ type: 'set', slots, value: slots.length * E().pointValue(rank), containsRank: rank });
      } else if (cards.length === 2 && jokersLeft.length > 0) {
        const joker = jokersLeft[0];
        const slots = [...cards.map((c) => ({ cardId: c.id })), { cardId: joker.id, wildAs: { rank } }];
        out.push({ type: 'set', slots, value: 2 * E().pointValue(rank) + 50, usesJoker: joker.id, containsRank: rank });
      }
    }
    return out;
  }

  function findCandidateRuns(hand, jokersLeft) {
    const out = [];
    const groups = suitGroups(hand);
    for (const suit of Object.keys(groups)) {
      for (const aceHigh of [false, true]) {
        const cards = groups[suit]
          .map((c) => ({ card: c, v: E().orderedRankValue(c.rank, aceHigh) }))
          .sort((a, b) => a.v - b.v);
        let i = 0;
        while (i < cards.length) {
          let j = i;
          const window = [cards[i]];
          while (j + 1 < cards.length && cards[j + 1].v === cards[j].v + 1) {
            j++;
            window.push(cards[j]);
          }
          if (window.length >= 3) {
            const slots = window.map((w) => ({ cardId: w.card.id }));
            out.push({ type: 'run', slots, value: slots.reduce((s, x) => s + E().pointValue(window.find((w) => w.card.id === x.cardId).card.rank), 0) });
          } else if (window.length === 2 && jokersLeft.length > 0) {
            const joker = jokersLeft[0];
            const gapV = window[1].v + 1; // extend upward by one using joker
            if (gapV <= 13) {
              const rankName = Object.entries({ A: aceHigh ? 14 : 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 }).find(([, v]) => v === gapV)?.[0];
              if (rankName) {
                const slots = [...window.map((w) => ({ cardId: w.card.id })), { cardId: joker.id, wildAs: { rank: rankName, suit } }];
                out.push({ type: 'run', slots, value: window.reduce((s, w) => s + E().pointValue(w.card.rank), 0) + 50, usesJoker: joker.id });
              }
            }
          }
          i = j + 1;
        }
      }
    }
    return out;
  }

  // Taking from the open row is voluntary, and the bottom card MUST be
  // melded this turn (§2.5) — this checks whether a meld containing it is
  // actually formable from hand + the whole scoop, so neither the AI nor
  // (via app.js) a human gets a false sense that a pickup is safe.
  function canResolvePickup(hand, openRow, cardId) {
    const hypotheticalHand = hand.concat(openRow);
    const jokersLeft = hypotheticalHand.filter((c) => c.rank === 'JOKER');
    const sets = findCandidateSets(hypotheticalHand, jokersLeft);
    const runs = findCandidateRuns(hypotheticalHand, jokersLeft);
    // Must also leave at least one card in hand afterward (layNewMeld
    // rejects using the whole hand) — a candidate meld that happens to BE
    // the entire post-pickup hand doesn't actually resolve the obligation,
    // and can strand a player with no legal move and (if it's the AI, which
    // never uses "Undo pickup") no way back either.
    return [...sets, ...runs].some(
      (cand) => cand.slots.length < hypotheticalHand.length && cand.slots.some((s) => s.cardId === cardId)
    );
  }

  function pickDraw(game) {
    const r = game.round;
    const E_ = E();
    if (!E_.canDrawFromRow(game)) return { source: 'closed' };
    const bottom = r.openRow[0];
    const scoopSize = r.openRow.length;
    const hand = r.hands[r.current];
    const wouldHelp = hand.some((c) => c.rank === bottom.rank || c.suit === bottom.suit);
    if (scoopSize > 2 || !wouldHelp) return { source: 'closed' };
    if (!canResolvePickup(hand, r.openRow, bottom.id)) return { source: 'closed' };
    return { source: 'row', cardId: bottom.id };
  }

  function playPart2(game) {
    const r = game.round;
    const E_ = E();
    let guard = 0;
    while (guard++ < 12) {
      const hand = r.hands[r.current];
      const jokersLeft = hand.filter((c) => c.rank === 'JOKER');
      const obligated = r.pendingObligations.slice();

      // Obligated cards (from an open-row pickup, §2.5) come first regardless
      // of come-out status — laying a brand-new meld is always legal even
      // pre-come-out, so this can't get starved out by come-out melds that
      // don't happen to include the obligated card.
      if (obligated.length > 0) {
        const cardId = obligated[0];
        const card = hand.find((c) => c.id === cardId);
        if (!card) { r.pendingObligations.shift(); continue; }
        const placed =
          (E_.hasComeOut(game) && tryPlaceSingleCard(game, card)) ||
          tryLayMeldContaining(game, cardId, hand, jokersLeft);
        if (!placed) {
          // Genuinely stuck — shouldn't happen given canResolvePickup/
          // canReplayJokerAfterSwap, but those are heuristic candidate
          // searches, not exhaustive proofs. Fall back to undoing the
          // pickup that created this obligation (if that's what it was)
          // rather than stranding the AI permanently; takeTurn will get
          // another chance to draw differently next time it's called.
          if (E_.canUndoDraw(game)) E_.undoDraw(game);
          break;
        }
        continue;
      }

      if (!E_.hasComeOut(game)) {
        const sets = findCandidateSets(hand, jokersLeft);
        const runs = findCandidateRuns(hand, jokersLeft);
        const candidates = [...sets, ...runs].sort((a, b) => b.value - a.value);
        const fourKind = sets.find((s) => s.slots.length === 4);
        if (fourKind) {
          try {
            E_.layNewMeld(game, fourKind.slots);
            continue;
          } catch (e) { /* would empty the hand — fall through to the value-based attempt below */ }
        }
        // Try to reach 40 with as few melds as possible.
        let acc = r.comeOutAccum[r.current];
        let played = false;
        for (const cand of candidates) {
          if (acc >= 40) break;
          try {
            E_.layNewMeld(game, cand.slots);
            acc += cand.value;
            played = true;
            break; // re-evaluate hand/jokers fresh each loop
          } catch (e) { /* skip invalid, try next */ }
        }
        if (!played) break; // can't come out this turn
        continue;
      }

      const sets = findCandidateSets(hand, jokersLeft);
      const runs = findCandidateRuns(hand, jokersLeft);
      const candidates = [...sets, ...runs].sort((a, b) => b.value - a.value);
      if (candidates.length > 0) {
        try {
          E_.layNewMeld(game, candidates[0].slots);
          continue;
        } catch (e) { /* fallthrough */ }
      }

      let shed = false;
      for (const card of hand) {
        if (card.rank === 'JOKER') continue;
        if (tryPlaceSingleCard(game, card)) { shed = true; break; }
      }
      if (shed) continue;
      break;
    }
  }

  // Prefer reclaiming a joker over just padding a meld with a real card:
  // if some tableau meld has a joker standing in for exactly this card
  // (rank for a set; rank+suit for a run), swap it out instead of adding
  // alongside it. Reclaims a 50-point wildcard for redeployment rather than
  // leaving it sitting there doing nothing extra. The swap's "replay the
  // joker this turn" obligation is picked up automatically next loop
  // iteration by playPart2's existing obligation-first handling.
  function trySwapJoker(game, card) {
    const E_ = E();
    const r = game.round;
    for (const meld of r.tableau) {
      const jokerSlot = meld.slots.find((s) => s.card.rank === 'JOKER');
      if (!jokerSlot || !jokerSlot.wildAs || jokerSlot.wildAs.rank !== card.rank) continue;
      if (meld.type === 'run' && card.suit !== E_.meldSuit(meld)) continue;
      // Only swap if the joker can actually be replayed afterward — §2.3
      // requires it be played back into a meld that same turn, and this
      // AI's only real mechanism for placing a bare joker is folding it
      // into a brand-new meld (tryPlaceSingleCard's addToMeld heuristic
      // can't construct a wildAs for it). Without this check the AI could
      // strand itself with an unfulfillable replay obligation, the same
      // failure mode canResolvePickup already guards against for row
      // pickups. If it's not replayable, just adding the real card below
      // is still a fine, always-safe move.
      if (!canReplayJokerAfterSwap(r, jokerSlot.card, card)) continue;
      try {
        E_.swapJoker(game, meld.id, jokerSlot.card.id, card.id);
        return true;
      } catch (e) { /* try next meld */ }
    }
    return false;
  }

  function canReplayJokerAfterSwap(round, jokerCard, usedRealCard) {
    const hypotheticalHand = round.hands[round.current]
      .filter((c) => c.id !== usedRealCard.id)
      .concat([jokerCard]);
    const jokersLeft = hypotheticalHand.filter((c) => c.rank === 'JOKER');
    const sets = findCandidateSets(hypotheticalHand, jokersLeft);
    const runs = findCandidateRuns(hypotheticalHand, jokersLeft);
    // Must also leave at least one card in hand afterward (layNewMeld
    // rejects using the whole hand) — a candidate that happens to BE the
    // entire hypothetical hand doesn't actually resolve the obligation.
    return [...sets, ...runs].some(
      (cand) => cand.slots.length < hypotheticalHand.length && cand.slots.some((s) => s.cardId === jokerCard.id)
    );
  }

  function tryPlaceSingleCard(game, card) {
    if (trySwapJoker(game, card)) return true;
    const E_ = E();
    const r = game.round;
    for (const meld of r.tableau) {
      try {
        if (meld.type === 'set') {
          const rank = meld.slots.find((s) => s.card.rank !== 'JOKER')?.card.rank ?? meld.slots.find((s) => s.wildAs)?.wildAs.rank;
          if (card.rank === rank) {
            E_.addToMeld(game, meld.id, card.id);
            return true;
          }
        } else {
          const suit = meld.slots.find((s) => s.card.rank !== 'JOKER')?.card.suit ?? meld.slots.find((s) => s.wildAs)?.wildAs.suit;
          if (card.suit === suit) {
            E_.addToMeld(game, meld.id, card.id);
            return true;
          }
        }
      } catch (e) { /* not a legal extension, try next meld */ }
    }
    return false;
  }

  function tryLayMeldContaining(game, cardId, hand, jokersLeft) {
    const sets = findCandidateSets(hand, jokersLeft).filter((c) => c.slots.some((s) => s.cardId === cardId));
    const runs = findCandidateRuns(hand, jokersLeft).filter((c) => c.slots.some((s) => s.cardId === cardId));
    const cand = [...sets, ...runs][0];
    if (!cand) return false;
    try {
      E().layNewMeld(game, cand.slots);
      return true;
    } catch (e) {
      return false;
    }
  }

  function pickDiscard(game) {
    const hand = game.round.hands[game.round.current];
    const nonJokers = hand.filter((c) => c.rank !== 'JOKER');
    const pool = nonJokers.length ? nonJokers : hand;
    pool.sort((a, b) => E().pointValue(b.rank) - E().pointValue(a.rank));
    return pool[0].id;
  }

  function takeTurn(game, callbacks) {
    const E_ = E();
    const r = game.round;

    if (r.part === 'turn0') {
      // AI always declines the exchange to keep the spike simple.
      E_.turn0Decline(game);
      callbacks.onStateChanged();
      return;
    }

    if (r.part === 1) {
      const draw = pickDraw(game);
      if (draw.source === 'row') {
        // The AI keeps it simple and never repeats a row-take (§2.3 allows
        // it, but one draw is enough for this heuristic) — it must now
        // explicitly finish drawing, since a row-take no longer auto-
        // advances to Part 2 on its own.
        E_.drawFromOpenRow(game, draw.cardId);
        if (r.ended) { callbacks.onStateChanged(); return; }
        E_.finishDrawing(game);
      } else {
        E_.drawFromClosedPile(game);
      }
      if (r.ended) { callbacks.onStateChanged(); return; }
      callbacks.onStateChanged();
    }

    playPart2(game);
    if (r.ended) { callbacks.onStateChanged(); return; }
    callbacks.onStateChanged();

    if (E_.canProceedToDiscard(game)) {
      const cardId = pickDiscard(game);
      E_.discard(game, cardId);
    }
    callbacks.onStateChanged();
  }

  return { takeTurn, pickDraw, pickDiscard, canResolvePickup };
})();

if (typeof window !== 'undefined') window.CascadeAI = CascadeAI;
