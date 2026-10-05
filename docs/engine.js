// Cascade Sevens — pure rules engine (framework-agnostic), per DESIGN.md.
// No DOM access here. State is plain data; every mutation goes through an
// exported function so app.ts/ai.ts never poke internals directly.
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
function pointValue(rank) {
    if (rank === "JOKER")
        return 50;
    if (rank === "A")
        return 25;
    if (["10", "J", "Q", "K"].includes(rank))
        return 10;
    return 5;
}
function buildDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS)
            deck.push({ id: `${r}${s}`, rank: r, suit: s });
    }
    deck.push({ id: "JOKER-1", rank: "JOKER", suit: null });
    deck.push({ id: "JOKER-2", rank: "JOKER", suit: null });
    return deck;
}
// A small deterministic PRNG (mulberry32) seeded by an integer -- lets a whole deal
// (shuffle + starter coin-flip) be reproduced later from just the seed
// value, e.g. to replay a disputed game (#16). Not cryptographically
// strong; only needs to be deterministic and reasonably well-distributed
// for shuffling. AI play has no randomness of its own (see ai.ts), so a
// reproduced deal plus the same sequence of actions reproduces the whole
// game, not just the initial hands.
// Any finite number is a valid seed: it is floored and wrapped to 32 bits, so
// negative or huge seeds work (the old LCG returned values outside [0, 1) for
// negative seeds, which dealt undefined cards, and had only 233,280 states).
function seededRng(seed) {
    let s = Math.floor(seed) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
// Who starts round 1 is random; the starter alternates every round after
// that (confirmed against the designer 2026-07-27 — this was previously
// an unconfirmed assumption defaulting to "player 1 always starts").
function newGame(mode = "standard", rng = Math.random) {
    return {
        mode, // 'standard' (>1000) or 'quick' (>300)
        threshold: mode === "quick" ? 300 : 1000,
        scores: [0, 0],
        roundNumber: 0,
        gameOver: false,
        winner: null,
        round: null,
        nextRoundStarter: rng() < 0.5 ? 0 : 1,
    };
}
function startRound(game, rng = Math.random) {
    const deck = shuffle(buildDeck(), rng);
    const hands = [deck.slice(0, 7), deck.slice(7, 14)];
    const rest = deck.slice(14);
    const openRow = [rest.pop()];
    game.roundNumber += 1;
    const starter = game.nextRoundStarter;
    game.round = {
        closedPile: rest,
        openRow, // index 0 = oldest/bottom, last = newest/top
        hands,
        tableau: [], // [{id, type:'set'|'run', slots:[{card, ownerId, wildAs}]}]
        nextMeldSeq: 0,
        comeOut: [false, false],
        starter, // which player index starts this round's Turn 0 + (normally) Turn 1
        current: starter, // player index whose turn it is
        part: "turn0",
        turn0: { stage: "starterFirst", resolved: false, lastAcceptor: null },
        pendingObligations: [], // card ids that must be laid on the table before Part 3
        // Which entry in pendingObligations (if any) is the current cascade
        // take's bottom card. Only the newest take's bottom card is owed.
        rowObligationCardId: null,
        lastDraw: null, // undoable until any other Part 2 action happens
        rearrange: null, // active draft-then-commit tableau rearrange session (§2.3), or null
        turnStart: null,
        rowDrawsThisPart1: 0, // repeat open-row takes within Part 1 (§2.3, revised 2026-07-26); resets each turn
        comeOutAccum: [0, 0], // points of new melds laid THIS turn toward the 40-point come-out bar (§2.4, revised 2026-10-03: single turn, no carry-over)
        comeOutAttempt: null, // snapshot for taking this turn's under-40 melds back
        comeOutMetThisTurn: false,
        log: [],
        ended: false,
        endReason: null,
        roundWinner: null,
    };
    game.nextRoundStarter = other(starter); // alternates for whichever round comes after this one
    logMsg(game, `Round ${game.roundNumber} dealt. Mode: ${game.mode}. Player ${starter + 1} starts.`);
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
    if (r.part !== "turn0" || r.turn0.resolved)
        return null;
    const stage = r.turn0.stage;
    if (stage === "starterFirst" || stage === "starterFollowup")
        return r.starter;
    if (stage === "otherSecond")
        return other(r.starter);
    return null;
}
function turn0Decline(game) {
    const t = game.round.turn0;
    if (t.resolved)
        throw new Error("Turn 0 already resolved.");
    if (t.stage === "starterFirst") {
        t.stage = "otherSecond";
        return;
    }
    if (t.stage === "otherSecond") {
        t.resolved = true;
        logMsg(game, "Both players declined the Turn 0 exchange.");
        beginNormalRotation(game);
        return;
    }
    // t.stage === 'starterFollowup': the starter declined the consolation look.
    t.resolved = true;
    logMsg(game, "Turn 0 exchange ends after one swap.");
    beginNormalRotation(game);
}
function turn0Accept(game, replacementCardId) {
    const r = game.round;
    const t = r.turn0;
    const takerIdx = turn0CurrentAskee(game);
    if (takerIdx === null)
        throw new Error("Turn 0 closed.");
    const hand = r.hands[takerIdx];
    // Validate before touching any state, so a bad id leaves the game as it was.
    const starter = r.openRow[r.openRow.length - 1];
    if (!starter)
        throw new Error("There is no starter card to take.");
    if (!hand.some((c) => c.id === replacementCardId) &&
        starter.id !== replacementCardId)
        throw new Error("Replacement card not in hand.");
    r.openRow.pop();
    hand.push(starter);
    const [placed] = hand.splice(findCard(hand, replacementCardId), 1);
    r.openRow.push(placed);
    t.lastAcceptor = takerIdx;
    logMsg(game, `Player ${takerIdx + 1} took the starter card and swapped in ${placed.rank}${placed.suit || ""}.`);
    if (t.stage === "starterFirst") {
        t.resolved = true; // starter taking it immediately ends Turn 0 — no follow-up for the other player.
        beginNormalRotation(game);
    }
    else if (t.stage === "otherSecond") {
        t.stage = "starterFollowup"; // the starter passed on it, so they get one consolation look now.
    }
    else {
        // t.stage === 'starterFollowup'
        t.resolved = true;
        beginNormalRotation(game);
    }
}
// Confirmed against the designer (2026-07-27): taking the starter card
// and swapping "uses up" that player's go, the same way a normal turn
// would — so whoever made the LAST accepted swap in Turn 0 hands Turn 1
// to their opponent, not to themselves. If nobody ever accepted anything
// (both declined), nothing was "used" and the original starter begins
// Turn 1 as normal.
function beginNormalRotation(game) {
    const r = game.round;
    r.part = 1;
    r.current =
        r.turn0.lastAcceptor !== null ? other(r.turn0.lastAcceptor) : r.starter;
    logMsg(game, `Turn 0 resolved. Player ${r.current + 1}'s turn begins.`);
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
// Added 2026-10-04 (DESIGN.md decision 24, requested by Tommer): once a
// player has taken from the cascade this turn they may keep taking after
// laying series too (take, lay, take again). The pile stays locked.
function canDrawFromRow(game) {
    const r = game.round;
    if (r.ended || r.openRow.length === 0)
        return false;
    if (r.part === 1)
        return true;
    return r.part === 2 && r.rowDrawsThisPart1 > 0 && !r.rearrange;
}
function canDrawFromClosedPile(game) {
    const r = game.round;
    return r.part === 1 && !r.ended && r.rowDrawsThisPart1 === 0;
}
function drawFromClosedPile(game) {
    const r = game.round;
    if (!canDrawFromClosedPile(game)) {
        throw new Error(r.ended
            ? "The round has ended."
            : r.part !== 1
                ? "You can only do that while drawing."
                : "Already took from the cascade this turn — the pile is no longer available.");
    }
    if (r.closedPile.length === 0) {
        endRoundPileEmpty(game);
        return;
    }
    const card = r.closedPile.pop();
    r.hands[r.current].push(card);
    logMsg(game, `Player ${r.current + 1} drew from the pile.`);
    r.part = 2;
    r.lastDraw = null;
}
function drawFromOpenRow(game, cardId) {
    const r = game.round;
    if (!canDrawFromRow(game))
        throw new Error("You can only take from the cascade while drawing (or after a take this turn), and only if it has cards.");
    const idx = r.openRow.findIndex((c) => c.id === cardId);
    if (idx === -1)
        throw new Error("Card not in the cascade.");
    if (!r.turnStart) {
        r.turnStart = structuredClone({
            hand: r.hands[r.current],
            openRow: r.openRow,
            tableau: r.tableau,
            comeOut: r.comeOut[r.current],
            comeOutAccum: r.comeOutAccum[r.current],
        });
    }
    const taken = r.openRow.splice(idx); // this card + everything after it
    r.hands[r.current].push(...taken);
    const bottomCard = taken[0];
    const priorObligations = r.pendingObligations.slice();
    const priorRowObligationCardId = r.rowObligationCardId;
    // Supersedes any earlier take's obligation, but a joker-swap obligation
    // (meld-only, possible once a take happens after laying) must survive.
    r.pendingObligations = [
        ...r.pendingObligations.filter((id) => id !== priorRowObligationCardId),
        bottomCard.id,
    ];
    r.rowObligationCardId = bottomCard.id;
    r.rowDrawsThisPart1 += 1;
    const partBefore = r.part;
    r.part = 2; // a take no longer needs a separate "Done drawing" step
    logMsg(game, `Player ${r.current + 1} took ${taken.length} card(s) from the cascade (must lay ${bottomCard.rank}${bottomCard.suit || ""} on the table).`);
    r.lastDraw = {
        source: "row",
        takenCards: taken.slice(),
        priorObligations,
        priorRowObligationCardId,
        partBefore,
        previous: r.lastDraw,
    };
    r.comeOutAttempt?.laterTakes.push(r.lastDraw);
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
    if (r.part === 2 && r.rowDrawsThisPart1 > 0)
        return; // a take already moved us on
    if (!canFinishDrawing(game))
        throw new Error("Nothing to finish — draw first.");
    r.part = 2;
    // lastDraw deliberately survives this transition — see canUndoDraw.
}
// Last-resort escape for a stuck turn (DESIGN decision 25): an owed cascade
// card can't be discarded, and once other series are laid the pickup can no
// longer be undone card by card. This puts the whole turn back to just before
// the first cascade take (hand, cascade, table, come-out progress), after
// which the player draws again -- from the pile if they like. Nothing hidden
// is revealed (the cascade is public, the pile is not touched), so it gives
// no information advantage.
function canRestartTurn(game) {
    const r = game.round;
    return r.part === 2 && !r.ended && !r.rearrange && !!r.turnStart;
}
function restartTurn(game) {
    const r = game.round;
    if (!canRestartTurn(game))
        throw new Error("There is no turn to start over.");
    const start = structuredClone(r.turnStart);
    r.hands[r.current] = start.hand;
    r.openRow = start.openRow;
    r.tableau = start.tableau;
    r.comeOut[r.current] = start.comeOut;
    r.comeOutAccum[r.current] = start.comeOutAccum;
    r.comeOutAttempt = null;
    r.pendingObligations = [];
    r.rowObligationCardId = null;
    r.lastDraw = null;
    r.rowDrawsThisPart1 = 0;
    r.turnStart = null;
    r.part = 1;
    logMsg(game, `Player ${r.current + 1} started the turn over.`);
}
// Taking from the open row is voluntary in principle (§2.5) — a player
// shouldn't take a card they can't meld — but nothing stops a human from
// doing it anyway and then discovering they're stuck. This is the escape
// hatch: undo the most recent row-take, provided no *meld* action has
// happened since (another row-take, or any Part 2 meld/add/swap/pull all
// close the window by clearing lastDraw). Moving from Part 1 into Part 2
// via finishDrawing does NOT close it on its own — that would strand a
// player who clicks "Done drawing" before realizing they're stuck, which
// is exactly the scenario this escape hatch exists for.
function canUndoDraw(game) {
    const r = game.round;
    return !!r.lastDraw && r.lastDraw.source === "row";
}
function undoDraw(game) {
    const r = game.round;
    if (!canUndoDraw(game))
        throw new Error("Nothing to undo.");
    const draw = r.lastDraw;
    returnTakeToRow(r, draw);
    r.part = draw.partBefore; // reverts finishDrawing too, if it had already happened
    r.lastDraw = draw.previous; // step back: the take before this one is undoable next
    const later = r.comeOutAttempt?.laterTakes;
    if (later) {
        const i = later.indexOf(draw);
        if (i !== -1)
            later.splice(i, 1);
    }
    logMsg(game, `Player ${r.current + 1} undid taking from the cascade.`);
}
// Puts one take's cards back at the end of the cascade and restores the
// obligation state from before it.
function returnTakeToRow(r, draw) {
    const hand = r.hands[r.current];
    for (const c of draw.takenCards) {
        if (findCard(hand, c.id) === -1)
            throw new Error("Cannot undo — hand has changed since the draw.");
    }
    for (const c of draw.takenCards) {
        hand.splice(findCard(hand, c.id), 1);
    }
    r.openRow.push(...draw.takenCards);
    r.pendingObligations = draw.priorObligations;
    r.rowObligationCardId = draw.priorRowObligationCardId;
    r.rowDrawsThisPart1 -= 1;
}
// --- Meld validation ------------------------------------------------------
function orderedRankValue(rank, aceHigh) {
    const map = {
        A: aceHigh ? 14 : 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 5,
        "6": 6,
        "7": 7,
        "8": 8,
        "9": 9,
        "10": 10,
        J: 11,
        Q: 12,
        K: 13,
    };
    return map[rank];
}
function rankNameForValue(value, aceHigh) {
    if (value === (aceHigh ? 14 : 1))
        return "A";
    const names = {
        2: "2",
        3: "3",
        4: "4",
        5: "5",
        6: "6",
        7: "7",
        8: "8",
        9: "9",
        10: "10",
        11: "J",
        12: "Q",
        13: "K",
    };
    return names[value] || null;
}
// Given a fixed set of real cards (must all share a suit) and a set of
// jokers (flexible — their represented rank is solved for, not given),
// determines whether ANY valid run can be formed and, if so, returns it
// fully ordered (tryAsRun/addToMeld's sequence checks are order-
// dependent, so this always returns cards left-to-right by value).
// Shared by autoResolveMeld (laying a brand-new meld from a hand
// selection) and addToMeld's joker-reposition fallback (§2.3, added
// 2026-07-27 — e.g. a run of JOKER(as 9),10,J can become
// 10,J,QUEEN(joker),K when a K arrives, by reassigning what the joker
// stands for rather than rejecting the K outright).
function solveRun(reals, jokers) {
    if (reals.length === 0)
        return { ok: false };
    if (!reals.every((c) => c.suit === reals[0].suit))
        return { ok: false };
    const suit = reals[0].suit;
    for (const aceHigh of [false, true]) {
        const values = reals.map((c) => orderedRankValue(c.rank, aceHigh));
        if (new Set(values).size !== values.length)
            continue; // can't happen with a real deck, but be safe
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spanReals = max - min + 1;
        const internalGaps = spanReals - reals.length;
        const totalSize = reals.length + jokers.length;
        if (internalGaps > jokers.length || totalSize > 13)
            continue;
        // Fill internal gaps first, then extend outward with whatever's left.
        const filled = new Set(values);
        let spare = jokers.length - internalGaps;
        for (let v = min; v <= max; v++)
            filled.add(v);
        let lo = min, hi = max;
        while (spare > 0) {
            if (lo > 1) {
                lo -= 1;
                filled.add(lo);
                spare -= 1;
            }
            else if (hi < 13) {
                hi += 1;
                filled.add(hi);
                spare -= 1;
            }
            else
                break;
        }
        if (spare > 0)
            continue; // ran out of room (shouldn't happen given the totalSize<=13 check)
        const jokerValues = [...filled]
            .filter((v) => !values.includes(v))
            .sort((a, b) => a - b);
        const unordered = [
            ...reals.map((c) => ({
                cardId: c.id,
                value: orderedRankValue(c.rank, aceHigh),
            })),
            ...jokers.map((c, i) => ({
                cardId: c.id,
                wildAs: { rank: rankNameForValue(jokerValues[i], aceHigh) },
                value: jokerValues[i],
            })),
        ];
        unordered.sort((a, b) => a.value - b.value);
        const slots = unordered.map(({ cardId, wildAs }) => wildAs ? { cardId, wildAs } : { cardId });
        return { ok: true, type: "run", suit, slots };
    }
    return { ok: false };
}
// Given a plain array of real card objects, does ANY valid meld (set or
// run) exist for them — including every way any jokers among them could
// fill in? Shared by autoResolveMeld (a hand selection) and rearrange
// sessions (a draft group of cards pulled from anywhere).
function resolveGroup(cards) {
    const jokers = cards.filter((c) => c.rank === "JOKER");
    const reals = cards.filter((c) => c.rank !== "JOKER");
    if (reals.length === 0) {
        return {
            ok: false,
            error: "A series needs at least one real (non-joker) card.",
        };
    }
    // Try as a set: every real card must already share one rank.
    if (reals.every((c) => c.rank === reals[0].rank)) {
        const rank = reals[0].rank;
        const slots = [
            ...reals.map((c) => ({ cardId: c.id })),
            ...jokers.map((c) => ({ cardId: c.id, wildAs: { rank } })),
        ];
        return { ok: true, type: "set", slots };
    }
    // Try as a run: every real card must share one suit.
    const runResult = solveRun(reals, jokers);
    if (runResult.ok)
        return runResult;
    return {
        ok: false,
        error: "No valid set or run is possible with these cards.",
    };
}
function autoResolveMeld(hand, cardIds) {
    if (cardIds.length < 3)
        return { ok: false, error: "A series needs at least 3 cards." };
    const cards = cardIds.map((id) => hand.find((h) => h.id === id));
    if (cards.some((c) => !c))
        return { ok: false, error: "Selected card not in hand." };
    return resolveGroup(cards);
}
// slots: [{cardId, wildAs?: {rank, suit?}}] pulled from hand, in the order
// the player wants them (for runs, order defines the sequence direction).
function validateNewMeldSelection(hand, slots) {
    if (slots.length < 3)
        return { ok: false, error: "A series needs at least 3 cards." };
    const cards = slots.map((s) => {
        const c = hand.find((h) => h.id === s.cardId);
        if (!c)
            throw new Error("Selected card not in hand.");
        return { real: c, wildAs: s.wildAs || null };
    });
    const setResult = tryAsSet(cards);
    if (setResult.ok)
        return setResult;
    const runResult = tryAsRun(cards);
    if (runResult.ok)
        return runResult;
    return {
        ok: false,
        error: (!setResult.ok && setResult.error) ||
            (!runResult.ok && runResult.error) ||
            "Not a valid set or run.",
    };
}
function tryAsSet(cards) {
    const nonJokers = cards.filter((c) => c.real.rank !== "JOKER");
    if (nonJokers.length === 0)
        return { ok: false, error: "A set needs at least one real card." };
    const rank = nonJokers[0].real.rank;
    for (const c of nonJokers) {
        if (c.real.rank !== rank)
            return { ok: false, error: "Not all cards share a rank." };
    }
    for (const c of cards) {
        if (c.real.rank === "JOKER" && c.wildAs && c.wildAs.rank !== rank) {
            return { ok: false, error: "Joker must stand in for the set rank." };
        }
    }
    return { ok: true, type: "set", rank };
}
function tryAsRun(cards) {
    const nonJokers = cards.filter((c) => c.real.rank !== "JOKER");
    if (nonJokers.length === 0)
        return { ok: false, error: "A run needs at least one real card." };
    const suit = nonJokers[0].real.suit;
    for (const c of nonJokers) {
        if (c.real.suit !== suit)
            return { ok: false, error: "Not all cards share a suit." };
    }
    // Try both ace-low and ace-high interpretations, sequence must match card order given.
    for (const aceHigh of [false, true]) {
        let ok = true;
        const values = [];
        for (const c of cards) {
            let rank;
            if (c.real.rank === "JOKER") {
                // A joker's suit in a run is always the run's own suit — it's
                // implied, not something the caller needs to (mis)supply. Only
                // the rank is meaningful, since that's what fixes its position
                // in the sequence.
                if (!c.wildAs || !c.wildAs.rank) {
                    ok = false;
                    break;
                }
                rank = c.wildAs.rank;
            }
            else {
                rank = c.real.rank;
            }
            const v = orderedRankValue(rank, aceHigh);
            values.push(v);
        }
        if (!ok)
            continue;
        let sequential = true;
        for (let i = 1; i < values.length; i++) {
            if (values[i] !== values[i - 1] + 1) {
                sequential = false;
                break;
            }
        }
        if (sequential && new Set(values).size === values.length) {
            return { ok: true, type: "run", suit, aceHigh };
        }
    }
    return {
        ok: false,
        error: "Cards are not a valid ascending sequence, same suit (no wraparound).",
    };
}
function meldValueFromSlots(slots) {
    return slots.reduce((sum, s) => sum + pointValue(s.card.rank), 0);
}
// --- Part 2: meld actions ---------------------------------------------------
function hasComeOut(game) {
    return game.round.comeOut[game.round.current];
}
function layNewMeld(game, cardSelections) {
    const r = game.round;
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    const hand = r.hands[r.current];
    const selectedIds = cardSelections.map((s) => s.cardId);
    // Every owed card (the cascade take's bottom card, a swapped-out joker)
    // must be laid on the table, so each one still owed after this action
    // counts toward the "keep enough cards to resolve everything" check.
    const meldOnlyObligationsAfter = r.pendingObligations.filter((id) => !selectedIds.includes(id)).length;
    assertLeavesHandUsable(hand, cardSelections.length, meldOnlyObligationsAfter);
    const result = validateNewMeldSelection(hand, cardSelections);
    if (!result.ok)
        throw new Error(result.error);
    if (!r.comeOut[r.current] && !r.comeOutAttempt) {
        r.comeOutAttempt = {
            meldIds: [],
            pendingObligations: [...r.pendingObligations],
            rowObligationCardId: r.rowObligationCardId,
            lastDraw: r.lastDraw,
            laterTakes: [],
        };
    }
    const slots = cardSelections.map((s) => {
        const ci = findCard(hand, s.cardId);
        const [card] = hand.splice(ci, 1);
        // Only rank is ever meaningful (see meldSuit) — normalize away any
        // suit the caller may have supplied so it can't end up in a display
        // label implying the joker impersonates one specific existing card.
        const wildAs = card.rank === "JOKER" && s.wildAs ? { rank: s.wildAs.rank } : null;
        return { card, ownerId: r.current, wildAs };
    });
    // A monotonic per-round counter, not r.tableau.length + Date.now() --
    // dissolving and recreating melds (tableau rearrangement, #18) can make
    // tableau.length repeat within a round, and a tight AI-vs-AI simulation
    // loop can call this multiple times within the same millisecond, so that
    // combination collided in real play: two melds ended up with the exact
    // same id, and dissolving one via pullFromMeld's
    // `r.tableau = r.tableau.filter(m => m.id !== meldId)` silently deleted
    // BOTH, losing the second meld's cards entirely (found via the 1000-game
    // AI stress simulation once the AI started actually calling pullFromMeld
    // -- confirmed by a card-conservation failure, not by inspection).
    const meld = {
        id: `m${r.nextMeldSeq++}`,
        type: result.type,
        slots,
    };
    r.tableau.push(meld);
    r.lastDraw = null; // an action happened this turn — the pickup can no longer be undone
    // clear pending obligations satisfied by this meld
    clearObligations(r, slots.map((s) => s.card.id));
    const value = meldValueFromSlots(slots);
    if (!r.comeOut[r.current]) {
        r.comeOutAccum[r.current] += value;
        r.comeOutAttempt?.meldIds.push(meld.id);
        if (r.comeOutAccum[r.current] >= 40) {
            r.comeOut[r.current] = true;
            r.comeOutAttempt = null; // out for good: nothing left to take back
            logMsg(game, `Player ${r.current + 1} came out!`);
        }
    }
    logMsg(game, `Player ${r.current + 1} laid a new series (${slots.map((s) => s.card.rank).join(",")}).`);
    return meld;
}
function clearObligations(r, cardIds) {
    r.pendingObligations = r.pendingObligations.filter((id) => !cardIds.includes(id));
    if (r.rowObligationCardId && cardIds.includes(r.rowObligationCardId)) {
        r.rowObligationCardId = null;
    }
}
// Guards the interaction between two rules that can otherwise collide:
// melding your entire hand is illegal outright (§3 decision 8), but a
// "must lay this card" obligation (the cascade take's bottom card, or a joker
// swap-out; neither may be discarded, see discard() below) demands exactly
// that card be laid that same turn. If an action is allowed to shrink the
// hand down to (or below) the number of cards still owed, that obligation
// becomes permanently unlayable -- every remaining meld action requires
// keeping at least one card behind, so a hand that equals its own
// obligation list can never legally clear it, and discard refuses to run
// while any obligation is outstanding. Checked, pre-mutation, by every
// action that can shrink the hand or add a new obligation (layNewMeld,
// addToMeld, swapJoker) using the hand size and the obligation count after
// the action would apply.
function assertLeavesHandUsable(hand, cardsBeingRemovedCount, obligationsAfterCount) {
    const remaining = hand.length - cardsBeingRemovedCount;
    if (obligationsAfterCount > 0 && remaining <= obligationsAfterCount) {
        throw new Error(`This would leave you unable to lay the ${obligationsAfterCount} card(s) you owe this turn without emptying your hand — lay the cards you owe first, or choose an action that doesn't shrink your hand this far.`);
    }
    if (obligationsAfterCount === 0 && remaining <= 0) {
        throw new Error("Cannot use your entire hand — you must keep at least one card to discard.");
    }
}
function addToMeld(game, meldId, cardId, wildAs) {
    const r = game.round;
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    if (!r.comeOut[r.current])
        throw new Error("You must come out before adding to a series.");
    const hand = r.hands[r.current];
    const ci = findCard(hand, cardId);
    if (ci === -1)
        throw new Error("Card not in hand.");
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld)
        throw new Error("Series not found.");
    const card = hand[ci];
    const meldOnlyObligationsAfter = r.pendingObligations.filter((id) => id !== card.id).length;
    assertLeavesHandUsable(hand, 1, meldOnlyObligationsAfter);
    if (card.rank === "JOKER" && !wildAs) {
        throw new Error("A joker needs a rank assignment to be added to a series.");
    }
    if (meld.type === "set") {
        const rank = meld.slots.find((s) => s.card.rank !== "JOKER")
            .card.rank;
        const cardRank = card.rank === "JOKER" ? wildAs.rank : card.rank;
        if (cardRank !== rank)
            throw new Error("Card does not match the set rank.");
        hand.splice(ci, 1);
        meld.slots.push({
            card,
            ownerId: r.current,
            wildAs: card.rank === "JOKER" ? { rank: wildAs.rank } : null,
        });
    }
    else {
        // A joker's suit in a run is always the run's own suit (implied, not
        // something the caller needs to supply) — only rank is meaningful.
        const suit = meldSuit(meld);
        const seq = meldRunValues(meld);
        const cardSuit = card.rank === "JOKER" ? suit : card.suit;
        const cardRank = card.rank === "JOKER" ? wildAs.rank : card.rank;
        if (cardSuit !== suit)
            throw new Error("Card does not match the run suit.");
        const v = orderedRankValue(cardRank, seq.aceHigh);
        const extendsLow = v === seq.min - 1 && v >= 1;
        const extendsHigh = v === seq.max + 1 && v <= 13;
        if (extendsLow || extendsHigh) {
            hand.splice(ci, 1);
            const newSlot = {
                card,
                ownerId: r.current,
                wildAs: card.rank === "JOKER" ? { rank: wildAs.rank } : null,
            };
            if (extendsLow)
                meld.slots.unshift(newSlot);
            else
                meld.slots.push(newSlot);
        }
        else {
            // Doesn't directly extend either end — but a joker already sitting
            // in the run might be repositionable to make room instead of
            // rejecting the card outright (§2.3, added 2026-07-27): e.g. a run
            // of JOKER(as 9),10,J can become 10,J,QUEEN(joker),K when a K
            // arrives, by reassigning what the joker stands for.
            if (card.rank === "JOKER")
                throw new Error("Card does not extend either end of the run.");
            const existingReals = meld.slots
                .filter((s) => s.card.rank !== "JOKER")
                .map((s) => s.card);
            const existingJokers = meld.slots
                .filter((s) => s.card.rank === "JOKER")
                .map((s) => s.card);
            const resolved = solveRun([...existingReals, card], existingJokers);
            if (!resolved.ok) {
                throw new Error("Card does not extend either end of the run, even allowing a joker to be repositioned.");
            }
            const ownerById = {};
            const cardById = {};
            for (const s of meld.slots) {
                ownerById[s.card.id] = s.ownerId;
                cardById[s.card.id] = s.card;
            }
            cardById[card.id] = card;
            hand.splice(ci, 1);
            // Ownership follows the act of placement (§2.8): the new card is
            // now owned by whoever added it; every other card — real or joker
            // — was already sitting in this meld and isn't being newly placed
            // by this action, so it keeps its existing owner even though its
            // position (or, for a joker, its represented rank) may have moved.
            meld.slots = resolved.slots.map((s) => ({
                card: cardById[s.cardId],
                ownerId: s.cardId === card.id ? r.current : ownerById[s.cardId],
                wildAs: s.wildAs || null,
            }));
        }
    }
    clearObligations(r, [card.id]);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} added ${card.rank}${card.suit || ""} to a series.`);
}
// A meld always has at least one real (non-joker) card — enforced at
// creation (tryAsSet/tryAsRun both reject an all-joker selection) — so
// this is always resolvable for a valid run.
function meldSuit(meld) {
    const real = meld.slots.find((s) => s.card.rank !== "JOKER");
    return real ? real.card.suit : null;
}
function meldRunValues(meld) {
    const values = meld.slots.map((s) => {
        const rank = s.card.rank === "JOKER"
            ? s.wildAs.rank
            : s.card.rank;
        return orderedRankValue(rank, false);
    });
    // pick interpretation consistent with the meld: recompute using both, take the one that's sequential
    for (const aceHigh of [false, true]) {
        const vs = meld.slots.map((s) => {
            const rank = s.card.rank === "JOKER"
                ? s.wildAs.rank
                : s.card.rank;
            return orderedRankValue(rank, aceHigh);
        });
        const sorted = vs.slice().sort((a, b) => a - b);
        let ok = true;
        for (let i = 1; i < sorted.length; i++)
            if (sorted[i] !== sorted[i - 1] + 1)
                ok = false;
        if (ok)
            return { min: sorted[0], max: sorted[sorted.length - 1], aceHigh };
    }
    const sorted = values.slice().sort((a, b) => a - b);
    return { min: sorted[0], max: sorted[sorted.length - 1], aceHigh: false };
}
// For a single card (possibly a joker) being added to an existing meld:
// no ambiguity for a set (always the meld's rank); for a run, try
// extending low then high. Returns null if a joker has no legal spot.
function autoResolveAddToMeld(meld, card) {
    if (card.rank !== "JOKER")
        return { wildAs: undefined };
    if (meld.type === "set") {
        const rank = meld.slots.find((s) => s.card.rank !== "JOKER")
            .card.rank;
        return { wildAs: { rank } };
    }
    const seq = meldRunValues(meld);
    for (const v of [seq.min - 1, seq.max + 1]) {
        if (v < 1 || v > 13)
            continue;
        const rank = rankNameForValue(v, seq.aceHigh);
        if (rank)
            return { wildAs: { rank } };
    }
    return null;
}
function swapJoker(game, meldId, jokerCardId, replacementCardId) {
    const r = game.round;
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    if (!r.comeOut[r.current])
        throw new Error("Must come out before swapping a joker.");
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld)
        throw new Error("Series not found.");
    const slotIdx = meld.slots.findIndex((s) => s.card.id === jokerCardId && s.card.rank === "JOKER");
    if (slotIdx === -1)
        throw new Error("Joker not found in that series.");
    const slot = meld.slots[slotIdx];
    const hand = r.hands[r.current];
    const ci = findCard(hand, replacementCardId);
    if (ci === -1)
        throw new Error("Replacement card not in hand.");
    const replacement = hand[ci];
    // Net hand size is unchanged by a swap (replacement out, joker back
    // in), but the joker becomes a new obligation -- so check against the
    // hand as it stands now (0 cards "removed") but with that obligation
    // added, alongside whatever obligations survive (the replacement card
    // itself might have been one, and is resolved by this same action).
    // The reclaimed joker itself is the +1.
    const meldOnlyObligationsAfter = r.pendingObligations.filter((id) => id !== replacementCardId).length + 1;
    assertLeavesHandUsable(hand, 0, meldOnlyObligationsAfter);
    const wildAs = slot.wildAs;
    if (meld.type === "set") {
        if (replacement.rank !== wildAs.rank) {
            throw new Error(`This joker stands in for a ${wildAs.rank} — swap requires the exact rank. To add your card to this series instead without touching the joker, use "Add to series."`);
        }
    }
    else {
        if (replacement.rank !== wildAs.rank ||
            replacement.suit !== meldSuit(meld)) {
            throw new Error(`This joker stands in for the ${wildAs.rank} of this run's suit — swap requires that exact card. If your card would extend the run instead, use "Add to series."`);
        }
    }
    hand.splice(ci, 1);
    // The replacement card keeps the joker slot's owner (DESIGN.md 2.8, decision
    // 23): swapping a joker out of the OPPONENT's series leaves your card
    // credited to the opponent, while the joker itself comes into your hand and
    // scores for you when you play it again. Swapping out your own joker keeps
    // the card yours.
    meld.slots[slotIdx] = {
        card: replacement,
        ownerId: slot.ownerId,
        wildAs: null,
    };
    hand.push(slot.card); // joker returns to hand
    r.pendingObligations.push(slot.card.id); // must be replayed into a meld this turn
    clearObligations(r, [replacement.id]);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} swapped a joker${slot.ownerId === r.current ? "" : ` out of Player ${slot.ownerId + 1}'s series`} for ${replacement.rank}${replacement.suit || ""}${slot.ownerId === r.current ? "" : ` (it stays with Player ${slot.ownerId + 1})`}.`);
}
// Validates a set of already-materialized meld slots ({card, wildAs}) —
// used to check what's left behind in a meld after pulling a card out.
function validateMeldSlots(slots) {
    const cards = slots.map((s) => ({
        real: s.card,
        wildAs: s.wildAs,
    }));
    const setResult = tryAsSet(cards);
    if (setResult.ok)
        return setResult;
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
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    if (!r.comeOut[r.current])
        throw new Error("You must come out before rearranging the table.");
    const meld = r.tableau.find((m) => m.id === meldId);
    if (!meld)
        throw new Error("Series not found.");
    const ids = Array.isArray(cardIds) ? cardIds : [cardIds];
    if (ids.length === 0)
        throw new Error("No cards specified to pull.");
    const pulled = [];
    const remaining = [];
    for (const slot of meld.slots) {
        if (ids.includes(slot.card.id))
            pulled.push(slot);
        else
            remaining.push(slot);
    }
    if (pulled.length !== ids.length)
        throw new Error("Some cards were not found in that series.");
    // Confirmed against the designer (2026-07-27): a player may only pull
    // cards THEY themselves currently own (i.e. placed most recently, per
    // §2.8's ownership-follows-placement rule) — not cards credited to the
    // opponent, even though either player can freely ADD to any meld.
    const notMine = pulled.find((slot) => slot.ownerId !== r.current);
    if (notMine) {
        throw new Error(`Can't pull ${notMine.card.rank}${notMine.card.suit || ""} — it's credited to the other player, and you can only pull back cards you placed yourself.`);
    }
    if (remaining.length > 0) {
        const check = remaining.length >= 3
            ? validateMeldSlots(remaining)
            : { ok: false };
        if (!check.ok) {
            throw new Error("Pulling those cards would leave an invalid series behind (fewer than 3 cards, or a broken run).");
        }
    }
    meld.slots = remaining;
    if (meld.slots.length === 0) {
        r.tableau = r.tableau.filter((m) => m.id !== meldId);
    }
    for (const slot of pulled)
        r.hands[r.current].push(slot.card);
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} pulled ${pulled.length} card(s) back from the table.`);
}
// --- Full tableau rearrange session (§2.3, added 2026-07-27) --------------
// A draft-then-commit workflow, distinct from the single-action pull
// above: within a session, ANY card on the table (either player's) plus
// the current player's own hand can be freely regrouped into new,
// possibly temporarily-illegal groupings — nothing is validated until
// commitRearrange, which checks every group and either applies the whole
// result or reports the specific problems so the player can keep
// adjusting or cancel back to exactly where they started. This is
// deliberately more permissive mid-session than the ownership-restricted
// single pull (which stays as the quick/simple option) — but two
// invariants keep it from reopening the exploit that restriction closed:
// (1) a pre-existing card always keeps its ORIGINAL owner no matter which
// group it ends up in — only cards newly brought in from hand are
// credited to the committing player; (2) any pre-existing card that isn't
// the committing player's own must end up in SOME valid group at commit
// — it can't just be absorbed into the committing player's hand.
// r.tableau/r.hands are never touched until a successful commit, so nothing
// else in the app sees an inconsistent state while a session is open.
function canStartRearrange(game) {
    const r = game.round;
    return (r.part === 2 &&
        !r.ended &&
        r.comeOut[r.current] &&
        // A reclaimed joker from a swap still blocks starting a session -- but
        // an outstanding row obligation doesn't (confirmed against the designer
        // 2026-07-27): it can be resolved by folding the card into a valid group
        // during the session (see commitRearrange, which clears the obligation
        // if that happens).
        r.pendingObligations.every((id) => id === r.rowObligationCardId) &&
        !r.rearrange);
}
function startRearrange(game) {
    if (!canStartRearrange(game)) {
        throw new Error("Cannot start rearranging right now.");
    }
    const r = game.round;
    const cardById = {};
    const originalOwnerByCardId = {};
    const groups = {};
    let groupCounter = 0;
    for (const meld of r.tableau) {
        const groupId = `g${groupCounter++}`;
        groups[groupId] = meld.slots.map((s) => s.card.id);
        for (const s of meld.slots) {
            cardById[s.card.id] = s.card;
            originalOwnerByCardId[s.card.id] = s.ownerId;
        }
    }
    const handPool = r.hands[r.current].map((c) => c.id);
    for (const c of r.hands[r.current])
        cardById[c.id] = c;
    r.rearrange = {
        cardById,
        originalOwnerByCardId,
        groups,
        handPool,
        nextGroupId: groupCounter,
    };
}
function rearrangeState(game) {
    const r = game.round;
    if (!r.rearrange)
        return null;
    const rr = r.rearrange;
    const groups = Object.keys(rr.groups).map((groupId) => {
        const cards = rr.groups[groupId].map((id) => rr.cardById[id]);
        const check = cards.length >= 3 ? resolveGroup(cards) : { ok: false };
        return {
            groupId,
            cardIds: rr.groups[groupId].slice(),
            valid: !!check.ok,
            type: check.ok ? check.type : null,
        };
    });
    return { groups, handPool: rr.handPool.slice() };
}
// destination: an existing group id, 'new' for a fresh group, or 'hand'.
function rearrangeMoveCard(game, cardId, destination) {
    const r = game.round;
    if (!r.rearrange)
        throw new Error("Not currently rearranging.");
    const rr = r.rearrange;
    if (!rr.cardById[cardId])
        throw new Error("Unknown card.");
    // Moving a card into the group that's currently exactly {that card} is a
    // no-op -- the card is already the entire content of that group. Must be
    // checked before the removal below: that removal deletes a now-empty
    // group immediately, so by the time the destination lookup ran, this
    // exact group would already be gone, turning a no-op into a confusing
    // "Unknown destination group" error (#23).
    if (destination !== "hand" &&
        destination !== "new" &&
        rr.groups[destination]?.length === 1 &&
        rr.groups[destination][0] === cardId) {
        return;
    }
    for (const gid of Object.keys(rr.groups)) {
        rr.groups[gid] = rr.groups[gid].filter((id) => id !== cardId);
    }
    rr.handPool = rr.handPool.filter((id) => id !== cardId);
    for (const gid of Object.keys(rr.groups)) {
        if (rr.groups[gid].length === 0)
            delete rr.groups[gid];
    }
    if (destination === "hand") {
        rr.handPool.push(cardId);
    }
    else if (destination === "new") {
        const newId = `g${rr.nextGroupId++}`;
        rr.groups[newId] = [cardId];
    }
    else if (rr.groups[destination]) {
        rr.groups[destination].push(cardId);
    }
    else {
        throw new Error("Unknown destination group.");
    }
}
function cancelRearrange(game) {
    const r = game.round;
    if (!r.rearrange)
        throw new Error("Not currently rearranging.");
    r.rearrange = null;
}
function commitRearrange(game) {
    const r = game.round;
    if (!r.rearrange)
        throw new Error("Not currently rearranging.");
    const rr = r.rearrange;
    const groupIds = Object.keys(rr.groups);
    const resolvedByGroup = {};
    const untouchedByGroup = {};
    const problems = [];
    for (const gid of groupIds) {
        const cardIds = rr.groups[gid];
        const cards = cardIds.map((id) => rr.cardById[id]);
        if (cards.length < 3) {
            problems.push({
                groupId: gid,
                cardIds,
                error: "A series needs at least 3 cards.",
            });
            continue;
        }
        // A group with exactly the cards of a series already on the table is
        // untouched: keep that series as it is. Re-solving it could move a
        // joker to a different card (the solver prefers the low end of a run),
        // which would let a rearrange silently change what the opponent's joker
        // stands for.
        const untouched = r.tableau.find((m) => m.slots.length === cardIds.length &&
            m.slots.every((sl) => cardIds.includes(sl.card.id)));
        if (untouched) {
            untouchedByGroup[gid] = untouched;
            continue;
        }
        const resolved = resolveGroup(cards);
        if (!resolved.ok) {
            problems.push({
                groupId: gid,
                cardIds,
                error: resolved.error || "Not a valid set or run.",
            });
        }
        else {
            resolvedByGroup[gid] = resolved;
        }
    }
    // A pre-existing card that isn't the committing player's own can't be
    // left sitting in hand — it has to end up in some valid group.
    for (const cardId of rr.handPool) {
        const originalOwner = rr.originalOwnerByCardId[cardId];
        if (originalOwner !== undefined && originalOwner !== r.current) {
            const c = rr.cardById[cardId];
            problems.push({
                cardId,
                error: `${c.rank}${c.suit || ""} belongs to the other player and can't be left in your hand — it must stay in some series.`,
            });
        }
    }
    const newHandIds = rr.handPool.slice();
    if (problems.length === 0 && newHandIds.length === 0) {
        problems.push({
            error: "You must keep at least one card in hand — you cannot place your entire hand onto the table.",
        });
    }
    if (problems.length > 0)
        return { ok: false, problems };
    const newTableau = groupIds.map((gid) => {
        const kept = untouchedByGroup[gid];
        if (kept)
            return { ...kept, id: gid };
        const resolved = resolvedByGroup[gid];
        return {
            id: gid,
            type: resolved.type,
            slots: resolved.slots.map((s) => ({
                card: rr.cardById[s.cardId],
                ownerId: rr.originalOwnerByCardId[s.cardId] !== undefined
                    ? rr.originalOwnerByCardId[s.cardId]
                    : r.current,
                wildAs: s.wildAs || null,
            })),
        };
    });
    r.tableau = newTableau;
    r.hands[r.current] = newHandIds.map((id) => rr.cardById[id]);
    // If an outstanding row obligation's card ended up folded into a valid
    // group (rather than left in hand), that resolves it the same way an
    // ordinary meld action would -- every group here has already passed
    // resolveGroup by this point, so there's nothing further to validate.
    if (r.rowObligationCardId && !newHandIds.includes(r.rowObligationCardId)) {
        clearObligations(r, [r.rowObligationCardId]);
    }
    r.rearrange = null;
    r.lastDraw = null;
    logMsg(game, `Player ${r.current + 1} rearranged the table.`);
    return { ok: true };
}
// --- Part 3: discard --------------------------------------------------------
// True if the player may discard right now: every card they owe this turn
// (§2.5: the cascade take's bottom card; §2.3: a swapped-out joker) has been
// laid on the table.
function canProceedToDiscard(game) {
    const r = game.round;
    return r.part === 2 && r.pendingObligations.length === 0;
}
// §2.4 (revised 2026-10-03): the 40 points to come out must be laid within a
// single turn. Returns how many more points the current player needs if they
// have under-40 melds on the table this turn (and so may not end the turn
// yet), else 0. The UI uses it to ask "lay more, or take them back?".
function comeOutShortfall(game) {
    const r = game.round;
    if (r.comeOut[r.current])
        return 0;
    const laid = r.comeOutAccum[r.current];
    return laid > 0 ? 40 - laid : 0;
}
// Takes this turn's under-40 melds back into the hand and restores the
// obligation / pickup-undo state from just before the first of them.
function takeBackUnqualifiedMelds(game) {
    const r = game.round;
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    const attempt = r.comeOutAttempt;
    if (r.comeOut[r.current] || !attempt || attempt.meldIds.length === 0)
        throw new Error("There are no under-40 series to take back.");
    const hand = r.hands[r.current];
    let cards = 0;
    r.tableau = r.tableau.filter((meld) => {
        if (!attempt.meldIds.includes(meld.id))
            return true;
        for (const slot of meld.slots) {
            hand.push(slot.card);
            cards++;
        }
        return false;
    });
    // Cascade takes made after the first series go back too (newest first),
    // so the state is exactly the one just before that first series.
    for (const take of [...attempt.laterTakes].reverse())
        returnTakeToRow(r, take);
    r.comeOutAccum[r.current] = 0;
    r.pendingObligations = [...attempt.pendingObligations];
    r.rowObligationCardId = attempt.rowObligationCardId;
    r.lastDraw = attempt.lastDraw;
    r.comeOutAttempt = null;
    logMsg(game, `Player ${r.current + 1} took ${cards} card(s) back (under 40 points to come out).`);
}
function discard(game, cardId) {
    const r = game.round;
    if (r.part !== 2)
        throw new Error("You can only do that after drawing, during your own turn.");
    if (r.rearrange)
        throw new Error("Finish or cancel the current rearrange session first.");
    const shortfall = comeOutShortfall(game);
    if (shortfall > 0)
        throw new Error(`You have to lay 40 points or more to come out (you have ${40 - shortfall}). Lay more, or take your cards back.`);
    const hand = r.hands[r.current];
    const ci = findCard(hand, cardId);
    if (ci === -1)
        throw new Error("Card not in hand.");
    // Every card owed this turn must be laid on the table first -- the
    // cascade take's bottom card (DESIGN decision 25, 2026-10-05: it can no
    // longer be discarded straight back) and a swapped-out joker alike.
    if (r.pendingObligations.length > 0)
        throw new Error("Cards you owe must be laid on the table first.");
    const [card] = hand.splice(ci, 1);
    r.openRow.push(card);
    logMsg(game, `Player ${r.current + 1} discarded ${card.rank}${card.suit || ""}.`);
    if (hand.length === 0) {
        endRoundHandOut(game, r.current);
        return;
    }
    // Empty closed pile (DESIGN decision 3): the round ends when the player who
    // drew the last card has finished their turn.
    if (r.closedPile.length === 0) {
        endRoundPileEmpty(game);
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
    r.comeOutAttempt = null;
    r.turnStart = null;
}
// --- Round / game end ---------------------------------------------------
function endRoundHandOut(game, winnerIdx) {
    const r = game.round;
    r.ended = true;
    r.endReason = "handout";
    r.roundWinner = winnerIdx;
    scoreRound(game);
}
function endRoundPileEmpty(game) {
    const r = game.round;
    r.ended = true;
    r.endReason = "pile-empty";
    r.roundWinner = null;
    scoreRound(game);
}
function scoreRound(game) {
    const r = game.round;
    const meldPoints = [0, 0];
    for (const meld of r.tableau) {
        for (const slot of meld.slots) {
            meldPoints[slot.ownerId] += pointValue(slot.card.rank);
        }
    }
    const roundScores = [meldPoints[0], meldPoints[1]];
    // Per-player breakdown label, logged alongside the totals below -- added
    // after a live-play report that the log only ever showed the final round
    // scores, with no way to see how they were actually made up (meld points
    // vs. the winner bonus vs. a hand penalty) without redoing the math by hand.
    const breakdown = ["", ""];
    if (r.roundWinner !== null) {
        roundScores[r.roundWinner] += 50;
        breakdown[r.roundWinner] = "winner bonus +50";
        const loser = other(r.roundWinner);
        const penalty = r.hands[loser].reduce((s, c) => s + pointValue(c.rank), 0);
        roundScores[loser] -= penalty;
        breakdown[loser] = `hand penalty -${penalty}`;
    }
    else {
        // pile-empty: both players penalized for their own remaining hand
        for (let p = 0; p < 2; p++) {
            const penalty = r.hands[p].reduce((s, c) => s + pointValue(c.rank), 0);
            roundScores[p] -= penalty;
            breakdown[p] = `hand penalty -${penalty}`;
        }
    }
    game.scores[0] += roundScores[0];
    game.scores[1] += roundScores[1];
    r.roundScores = roundScores;
    for (const p of [0, 1]) {
        logMsg(game, `Round score for Player ${p + 1}: ${roundScores[p]} (series points ${meldPoints[p]}${breakdown[p] ? `, ${breakdown[p]}` : ""}).`);
    }
    logMsg(game, `Round over (${r.endReason}). Round scores: P1 ${roundScores[0]}, P2 ${roundScores[1]}. Totals: P1 ${game.scores[0]}, P2 ${game.scores[1]}.`);
    checkGameEnd(game);
}
// §2.8 "app behavior": live running score, not just a round-end lump sum.
// Meld points already on the table score for the round in progress even
// before it ends, so the UI can show an always-current total.
function roundMeldPointsSoFar(game, playerIdx) {
    let total = 0;
    for (const meld of game.round.tableau) {
        for (const slot of meld.slots) {
            if (slot.ownerId === playerIdx)
                total += pointValue(slot.card.rank);
        }
    }
    return total;
}
function liveScore(game, playerIdx) {
    // Once the round has ended, scoreRound() has already folded this
    // round's meld points into game.scores — adding roundMeldPointsSoFar
    // on top would double-count them (the tableau isn't cleared until
    // "Next Round" actually starts a fresh round).
    if (game.round.ended)
        return game.scores[playerIdx];
    return game.scores[playerIdx] + roundMeldPointsSoFar(game, playerIdx);
}
function checkGameEnd(game) {
    const [a, b] = game.scores;
    if (a > game.threshold && a > b) {
        game.gameOver = true;
        game.winner = 0;
    }
    else if (b > game.threshold && b > a) {
        game.gameOver = true;
        game.winner = 1;
    }
}
export const CascadeEngine = {
    pointValue,
    buildDeck,
    shuffle,
    seededRng,
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
    canRestartTurn,
    restartTurn,
    validateNewMeldSelection,
    autoResolveMeld,
    hasComeOut,
    layNewMeld,
    addToMeld,
    swapJoker,
    pullFromMeld,
    canStartRearrange,
    startRearrange,
    rearrangeState,
    rearrangeMoveCard,
    cancelRearrange,
    commitRearrange,
    canProceedToDiscard,
    comeOutShortfall,
    takeBackUnqualifiedMelds,
    discard,
    orderedRankValue,
    solveRun,
    meldRunValues,
    meldSuit,
    autoResolveAddToMeld,
    roundMeldPointsSoFar,
    liveScore,
};
