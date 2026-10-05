// Cascade Sevens — simple heuristic AI (player index 1). Not the phase-2
// "real" AI from DESIGN.md §5.2 — just enough to hotseat-test the rules
// against something. Calls the same engine API a human UI would call.
import { CascadeEngine } from "./engine.js";
function rankGroups(hand) {
    const groups = {};
    for (const c of hand) {
        if (c.rank === "JOKER")
            continue;
        (groups[c.rank] = groups[c.rank] || []).push(c);
    }
    return groups;
}
function suitGroups(hand) {
    const groups = {};
    for (const c of hand) {
        if (c.rank === "JOKER")
            continue;
        const suit = c.suit;
        (groups[suit] = groups[suit] || []).push(c);
    }
    return groups;
}
function findCandidateSets(hand, jokersLeft) {
    const out = [];
    const groups = rankGroups(hand);
    for (const rank of Object.keys(groups)) {
        const cards = groups[rank];
        if (cards.length >= 3) {
            const slots = cards
                .slice(0, 4)
                .map((c) => ({ cardId: c.id }));
            out.push({
                type: "set",
                slots,
                value: slots.length * CascadeEngine.pointValue(rank),
                containsRank: rank,
            });
        }
        else if (cards.length === 2 && jokersLeft.length > 0) {
            const joker = jokersLeft[0];
            const slots = [
                ...cards.map((c) => ({ cardId: c.id })),
                { cardId: joker.id, wildAs: { rank } },
            ];
            out.push({
                type: "set",
                slots,
                value: 2 * CascadeEngine.pointValue(rank) + 50,
                usesJoker: joker.id,
                containsRank: rank,
            });
        }
    }
    return out;
}
// Tries every pair of same-suit real cards as a candidate run's low/high
// anchor, including everything else of that suit within the resulting
// span, and hands the actual gap-filling/extension math to the engine's
// own solveRun() (rather than re-deriving it here) so this correctly
// finds a joker filling an INTERNAL gap between two non-adjacent real
// cards (e.g. Q _ A needing a joker as K) -- not just a joker extending
// an already-adjacent pair. A prior version only handled the adjacent-
// pair-extended-upward-by-one case and missed exactly this, confirmed by
// a live report where Q-JOKER(as K)-A was rejected as "no legal meld
// possible" even though it's valid (2026-07-27).
function findCandidateRuns(hand, jokersLeft) {
    const out = [];
    const seen = new Set(); // dedupe identical slot sets across anchor pairs
    const groups = suitGroups(hand);
    for (const suit of Object.keys(groups)) {
        const cards = groups[suit];
        if (cards.length < 2)
            continue;
        for (let a = 0; a < cards.length; a++) {
            for (let b = a; b < cards.length; b++) {
                for (const jokerCount of [0, 1, jokersLeft.length].filter((n, i, arr) => arr.indexOf(n) === i)) {
                    if (jokerCount > jokersLeft.length)
                        continue;
                    const anchors = [cards[a], cards[b]];
                    for (const aceHigh of [false, true]) {
                        const lo = Math.min(...anchors.map((c) => CascadeEngine.orderedRankValue(c.rank, aceHigh)));
                        const hi = Math.max(...anchors.map((c) => CascadeEngine.orderedRankValue(c.rank, aceHigh)));
                        const within = cards.filter((c) => {
                            const v = CascadeEngine.orderedRankValue(c.rank, aceHigh);
                            return v >= lo && v <= hi;
                        });
                        if (within.length < 2)
                            continue;
                        const result = CascadeEngine.solveRun(within, jokersLeft.slice(0, jokerCount));
                        // solveRun itself has no minimum-length floor -- it assumes
                        // its caller already guarantees >=3 cards going in (true for
                        // its other callers, not for this exploratory search).
                        if (!result.ok || result.slots.length < 3)
                            continue;
                        const key = result.slots
                            .map((s) => s.cardId)
                            .sort()
                            .join(",");
                        if (seen.has(key))
                            continue;
                        seen.add(key);
                        const value = result.slots.reduce((sum, s) => {
                            if (s.wildAs)
                                return sum + CascadeEngine.pointValue("JOKER");
                            return (sum +
                                CascadeEngine.pointValue(within.find((c) => c.id === s.cardId).rank));
                        }, 0);
                        const usedJoker = result.slots.find((s) => s.wildAs);
                        out.push({
                            type: "run",
                            slots: result.slots,
                            value,
                            ...(usedJoker ? { usesJoker: usedJoker.cardId } : {}),
                        });
                    }
                }
            }
        }
    }
    return out;
}
// Taking from the open row is voluntary, and the bottom card MUST be
// melded this turn (§2.5) — this checks whether a meld containing it is
// actually formable from hand + the whole scoop, so neither the AI nor
// (via app.ts) a human gets a false sense that a pickup is safe.
//
// Deliberately does NOT also count a rearrangement-only resolution as
// "resolvable" here (#18) -- tried it, and it made the AI take pickups whose only
// resolution was dissolving one of its own melds, which in turn creates a
// fresh obligation resolvable only by dissolving *another* meld built from
// nearly the same cards, and so on. With no closed-pile draws ever
// happening (canResolvePickup kept saying the row was "safe"), two AI
// players reached a genuine infinite cycle -- the same ~7 cards endlessly
// reshuffled between two melds, 1000+ turns, no progress, caught by the
// stress simulation. Rearrangement stays scoped to what the acceptance
// criteria actually asked for: a fallback for a stranded obligation
// (tryResolveObligationViaRearrange below), not a reason to take on MORE
// obligations in the first place.
// Greedy estimate of the points of disjoint sets/runs this hand could lay in
// one turn (the same highest-value-first order playPart2 uses). Before coming
// out the AI needs 40 of these within a single turn (§2.4, revised
// 2026-10-03), so a row pickup that can't get there is pointless: it would
// just be taken back and discarded again, round and round.
function comeOutPotential(cards) {
    let rest = cards.slice();
    let total = 0;
    for (let guard = 0; guard < 8; guard++) {
        const jokers = rest.filter((c) => c.rank === "JOKER");
        const best = [
            ...findCandidateSets(rest, jokers),
            ...findCandidateRuns(rest, jokers),
        ].sort((a, b) => b.value - a.value)[0];
        if (!best)
            break;
        total += best.value;
        const used = new Set(best.slots.map((sl) => sl.cardId));
        rest = rest.filter((c) => !used.has(c.id));
    }
    return total;
}
function canResolvePickup(hand, openRow, cardId) {
    const hypotheticalHand = hand.concat(openRow);
    const jokersLeft = hypotheticalHand.filter((c) => c.rank === "JOKER");
    const sets = findCandidateSets(hypotheticalHand, jokersLeft);
    const runs = findCandidateRuns(hypotheticalHand, jokersLeft);
    // Must also leave at least one card in hand afterward (layNewMeld
    // rejects using the whole hand) — a candidate meld that happens to BE
    // the entire post-pickup hand doesn't actually resolve the obligation,
    // and can strand a player with no legal move and (if it's the AI, which
    // never uses "Undo pickup") no way back either.
    return [...sets, ...runs].some((cand) => cand.slots.length < hypotheticalHand.length &&
        cand.slots.some((s) => s.cardId === cardId));
}
// Scans every position in the open row, not just the very oldest card —
// r.openRow[0] alone (the original approach) means the AI could never
// even consider a great pickup sitting a few cards deep, no matter how
// useful, which read as "the AI is dumb" in testing and was a fair call.
// Each candidate still has to pass canResolvePickup (so the AI never
// strands itself the way a human ignoring the warning could), and among
// resolvable candidates this prefers a cheap, useful scoop over a huge
// one that dumps a lot of extra "junk" cards into hand at once.
function pickDraw(game) {
    const r = game.round;
    if (!CascadeEngine.canDrawFromRow(game))
        return { source: "closed" };
    const hand = r.hands[r.current];
    let best = null;
    for (let idx = 0; idx < r.openRow.length; idx++) {
        const bottom = r.openRow[idx];
        const scoop = r.openRow.slice(idx);
        // No cheap pre-filter here on purpose: a scoop can be entirely
        // self-sufficient (e.g. 3D,4D,5D is already a complete run on its
        // own), so checking the hand alone before calling canResolvePickup
        // would wrongly reject perfectly good pickups the hand contributes
        // nothing to.
        if (!canResolvePickup(hand, scoop, bottom.id))
            continue;
        if (!CascadeEngine.hasComeOut(game) &&
            comeOutPotential(hand.concat(scoop)) < 40)
            continue;
        const scoopValue = scoop.reduce((s, c) => s + CascadeEngine.pointValue(c.rank), 0);
        const score = scoopValue - (scoop.length - 1) * 5; // mild penalty for extra clutter cards
        if (!best || score > best.score)
            best = { cardId: bottom.id, score };
    }
    if (!best)
        return { source: "closed" };
    return { source: "row", cardId: best.cardId };
}
function playPart2(game) {
    const r = game.round;
    let guard = 0;
    while (guard++ < 12) {
        const hand = r.hands[r.current];
        const jokersLeft = hand.filter((c) => c.rank === "JOKER");
        const obligated = r.pendingObligations.slice();
        // Obligated cards (from an open-row pickup, §2.5) come first regardless
        // of come-out status — laying a brand-new meld is always legal even
        // pre-come-out, so this can't get starved out by come-out melds that
        // don't happen to include the obligated card.
        if (obligated.length > 0) {
            const cardId = obligated[0];
            const card = hand.find((c) => c.id === cardId);
            if (!card) {
                r.pendingObligations.shift();
                continue;
            }
            const placed = (CascadeEngine.hasComeOut(game) && tryPlaceSingleCard(game, card)) ||
                tryLayMeldContaining(game, cardId, hand, jokersLeft) ||
                (CascadeEngine.hasComeOut(game) &&
                    tryResolveObligationViaRearrange(game, cardId, hand));
            if (!placed) {
                // Genuinely stuck -- shouldn't happen given canResolvePickup/
                // canReplayJokerAfterSwap, but those are heuristic candidate
                // searches, not exhaustive proofs. An owed card can't be discarded
                // (DESIGN decision 25), so the way out is undoing the pickup that
                // created it; takeTurn then draws from the pile instead.
                if (CascadeEngine.canUndoDraw(game))
                    CascadeEngine.undoDraw(game);
                break;
            }
            continue;
        }
        if (!CascadeEngine.hasComeOut(game)) {
            const sets = findCandidateSets(hand, jokersLeft);
            const runs = findCandidateRuns(hand, jokersLeft);
            const candidates = [...sets, ...runs].sort((a, b) => b.value - a.value);
            const fourKind = sets.find((s) => s.slots.length === 4);
            if (fourKind) {
                try {
                    CascadeEngine.layNewMeld(game, fourKind.slots);
                    continue;
                }
                catch {
                    /* would empty the hand — fall through to the value-based attempt below */
                }
            }
            // Try to reach 40 with as few melds as possible.
            let acc = r.comeOutAccum[r.current];
            let played = false;
            for (const cand of candidates) {
                if (acc >= 40)
                    break;
                try {
                    CascadeEngine.layNewMeld(game, cand.slots);
                    acc += cand.value;
                    played = true;
                    break; // re-evaluate hand/jokers fresh each loop
                }
                catch {
                    /* skip invalid, try next */
                }
            }
            if (!played)
                break; // can't come out this turn
            continue;
        }
        const sets = findCandidateSets(hand, jokersLeft);
        const runs = findCandidateRuns(hand, jokersLeft);
        const candidates = [...sets, ...runs].sort((a, b) => b.value - a.value);
        // Try candidates in value order until one actually succeeds, rather
        // than betting everything on the highest-value one -- overlapping
        // candidates for the same cards can include one that would use the
        // entire hand (invalid) ranked ahead of an equally legal smaller one.
        let laid = false;
        for (const cand of candidates) {
            try {
                CascadeEngine.layNewMeld(game, cand.slots);
                laid = true;
                break;
            }
            catch {
                /* try the next candidate */
            }
        }
        if (laid)
            continue;
        let shed = false;
        for (const card of hand) {
            if (card.rank === "JOKER")
                continue;
            if (tryPlaceSingleCard(game, card)) {
                shed = true;
                break;
            }
        }
        if (shed)
            continue;
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
    const r = game.round;
    for (const meld of r.tableau) {
        const jokerSlot = meld.slots.find((s) => s.card.rank === "JOKER");
        if (!jokerSlot || !jokerSlot.wildAs || jokerSlot.wildAs.rank !== card.rank)
            continue;
        if (meld.type === "run" && card.suit !== CascadeEngine.meldSuit(meld))
            continue;
        // Only swap if the joker can actually be replayed afterward — §2.3
        // requires it be played back into a meld that same turn, and this
        // AI's only real mechanism for placing a bare joker is folding it
        // into a brand-new meld (tryPlaceSingleCard's addToMeld heuristic
        // can't construct a wildAs for it). Without this check the AI could
        // strand itself with an unfulfillable replay obligation, the same
        // failure mode canResolvePickup already guards against for row
        // pickups. If it's not replayable, just adding the real card below
        // is still a fine, always-safe move.
        if (!canReplayJokerAfterSwap(r, jokerSlot.card, card))
            continue;
        try {
            CascadeEngine.swapJoker(game, meld.id, jokerSlot.card.id, card.id);
            return true;
        }
        catch {
            /* try next meld */
        }
    }
    return false;
}
// Deliberately does NOT also count a rearrangement-only resolution as
// "resolvable" here, for the same reason as canResolvePickup above (see
// its comment) -- broadening this too, on top of canResolvePickup, is
// what actually produced the observed infinite cycle: a broadened
// canReplayJokerAfterSwap said a swap was fine, the swap created a new
// (joker) obligation, and resolving THAT via rearrangement dissolved yet
// another meld, feeding the same cycle from the other direction. Kept
// narrow on purpose.
function canReplayJokerAfterSwap(round, jokerCard, usedRealCard) {
    const hypotheticalHand = round.hands[round.current]
        .filter((c) => c.id !== usedRealCard.id)
        .concat([jokerCard]);
    const jokersLeft = hypotheticalHand.filter((c) => c.rank === "JOKER");
    const sets = findCandidateSets(hypotheticalHand, jokersLeft);
    const runs = findCandidateRuns(hypotheticalHand, jokersLeft);
    // Must also leave at least one card in hand afterward (layNewMeld
    // rejects using the whole hand) — a candidate that happens to BE the
    // entire hypothetical hand doesn't actually resolve the obligation.
    return [...sets, ...runs].some((cand) => cand.slots.length < hypotheticalHand.length &&
        cand.slots.some((s) => s.cardId === jokerCard.id));
}
function tryPlaceSingleCard(game, card) {
    if (trySwapJoker(game, card))
        return true;
    const r = game.round;
    for (const meld of r.tableau) {
        try {
            if (meld.type === "set") {
                const rank = meld.slots.find((s) => s.card.rank !== "JOKER")?.card.rank ??
                    meld.slots.find((s) => s.wildAs)?.wildAs?.rank;
                if (card.rank === rank) {
                    CascadeEngine.addToMeld(game, meld.id, card.id);
                    return true;
                }
            }
            else {
                const suit = meld.slots.find((s) => s.card.rank !== "JOKER")?.card.suit ??
                    meld.slots.find((s) => s.wildAs)?.wildAs?.suit;
                if (card.suit === suit) {
                    CascadeEngine.addToMeld(game, meld.id, card.id);
                    return true;
                }
            }
        }
        catch {
            /* not a legal extension, try next meld */
        }
    }
    return false;
}
// Fallback for a stranded obligated card that no simpler action can place
// (#18) -- this is the AI's only use of tableau rearrangement, deliberately
// narrow rather than a general rearrangement strategy: try dissolving one
// of the AI's own melds ENTIRELY (every slot owned by the current player,
// via the single-card pull -- pullFromMeld, §3 decision 2/11 -- not the
// full draft-then-commit session, which isn't worth the extra state
// machine for a heuristic bot) and see whether the freed cards plus hand
// can form a new meld containing the obligated card. Only whole-meld
// dissolves are tried (no partial-subset search) to keep this bounded and
// simple, matching the acceptance criteria's own example.
//
// Only called for an obligation that's ALREADY stranded (playPart2 tries
// this last, after simpler actions have already failed) -- never used to
// decide whether to take ON an obligation in the first place. An earlier
// version also broadened canResolvePickup/canReplayJokerAfterSwap to treat
// a rearrange-only resolution as "safe to take", which backfired: the AI
// started taking pickups/swaps whose only resolution was dissolving one of
// its own melds, each dissolve creating a fresh obligation resolvable only
// by dissolving *another* similar meld, and so on -- a real infinite cycle
// (the same ~7 cards endlessly reshuffled between two melds) caught by the
// 1000-game AI-vs-AI stress simulation. Reverted; kept narrow.
function tryResolveObligationViaRearrange(game, cardId, hand) {
    const r = game.round;
    for (const meld of r.tableau) {
        if (meld.slots.some((s) => s.ownerId !== r.current))
            continue; // only dissolve melds entirely our own
        const ownCards = meld.slots.map((s) => s.card);
        const virtualHand = hand.concat(ownCards);
        const virtualJokers = virtualHand.filter((c) => c.rank === "JOKER");
        const sets = findCandidateSets(virtualHand, virtualJokers).filter((c) => c.slots.some((s) => s.cardId === cardId));
        const runs = findCandidateRuns(virtualHand, virtualJokers).filter((c) => c.slots.some((s) => s.cardId === cardId));
        const candidate = [...sets, ...runs].find((c) => c.slots.length < virtualHand.length);
        if (!candidate)
            continue;
        try {
            CascadeEngine.pullFromMeld(game, meld.id, ownCards.map((c) => c.id));
        }
        catch {
            continue; // shouldn't happen for a whole-meld dissolve, but the engine is the authority
        }
        try {
            CascadeEngine.layNewMeld(game, candidate.slots);
            return true;
        }
        catch {
            // The pull already succeeded and can't be cleanly undone here, but
            // that's still a legal state (the cards just sit in hand) -- report
            // failure and let the caller's existing fallback (undo the draw, or
            // undo the draw) take over from there.
            return false;
        }
    }
    return false;
}
function tryLayMeldContaining(game, cardId, hand, jokersLeft) {
    const sets = findCandidateSets(hand, jokersLeft).filter((c) => c.slots.some((s) => s.cardId === cardId));
    const runs = findCandidateRuns(hand, jokersLeft).filter((c) => c.slots.some((s) => s.cardId === cardId));
    // Multiple overlapping candidates can legitimately exist for the same
    // card (e.g. a run findable via several different anchor spans) --
    // some may turn out to use the entire hand (which layNewMeld rejects)
    // even though a smaller, equally valid alternative exists. Try every
    // candidate in turn rather than betting everything on the first one;
    // giving up after a single failure caused a real AI stall (confirmed
    // 2026-07-27) whenever the first-found candidate happened to be the
    // whole-hand one.
    for (const cand of [...sets, ...runs]) {
        try {
            CascadeEngine.layNewMeld(game, cand.slots);
            return true;
        }
        catch {
            /* try the next candidate */
        }
    }
    return false;
}
function pickDiscard(game) {
    const r = game.round;
    const hand = r.hands[r.current];
    const nonJokers = hand.filter((c) => c.rank !== "JOKER");
    const pool = nonJokers.length ? nonJokers : hand;
    pool.sort((a, b) => CascadeEngine.pointValue(b.rank) - CascadeEngine.pointValue(a.rank));
    return pool[0].id;
}
function takeTurn(game, callbacks) {
    const r = game.round;
    if (r.part === "turn0") {
        // AI always declines the exchange to keep the spike simple.
        CascadeEngine.turn0Decline(game);
        callbacks.onStateChanged();
        return;
    }
    if (r.part === 1) {
        const draw = pickDraw(game);
        if (draw.source === "row") {
            // The AI keeps it simple and never repeats a row-take (§2.3 allows
            // it, but one draw is enough for this heuristic).
            CascadeEngine.drawFromOpenRow(game, draw.cardId);
        }
        else {
            CascadeEngine.drawFromClosedPile(game);
        }
        if (r.ended) {
            callbacks.onStateChanged();
            return;
        }
        callbacks.onStateChanged();
    }
    playPart2(game);
    if (r.ended) {
        callbacks.onStateChanged();
        return;
    }
    // Come-out needs 40+ within one turn (§2.4, revised 2026-10-03): if the
    // melds laid this turn fell short, take them back rather than being stuck
    // unable to end the turn.
    if (CascadeEngine.comeOutShortfall(game) > 0) {
        CascadeEngine.takeBackUnqualifiedMelds(game);
    }
    // A card owed from a cascade take can't be discarded (DESIGN decision 25).
    // If it is still owed here (it couldn't be laid, or a take-back above made
    // it owed again), undo the pickup and draw from the pile instead.
    if (r.pendingObligations.length > 0 || r.part === 1) {
        while (r.pendingObligations.length > 0 && CascadeEngine.canUndoDraw(game))
            CascadeEngine.undoDraw(game);
        // Not undoable card by card any more (other series were laid): start the
        // whole turn over.
        if (r.pendingObligations.length > 0 && CascadeEngine.canRestartTurn(game))
            CascadeEngine.restartTurn(game);
        if (r.part === 1) {
            CascadeEngine.drawFromClosedPile(game);
            if (r.ended) {
                callbacks.onStateChanged();
                return;
            }
            playPart2(game);
            if (r.ended) {
                callbacks.onStateChanged();
                return;
            }
            if (CascadeEngine.comeOutShortfall(game) > 0)
                CascadeEngine.takeBackUnqualifiedMelds(game);
        }
    }
    callbacks.onStateChanged();
    if (CascadeEngine.canProceedToDiscard(game)) {
        const cardId = pickDiscard(game);
        CascadeEngine.discard(game, cardId);
    }
    callbacks.onStateChanged();
}
export const CascadeAI = { takeTurn, pickDraw, pickDiscard, canResolvePickup };
