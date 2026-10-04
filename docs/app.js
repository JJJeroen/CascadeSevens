// Cascade Sevens — UI controller. Hotseat human (P1) vs simple AI (P2).
// Wires DOM events to CascadeEngine calls; no rules logic lives here.
import { CascadeEngine } from "./engine.js";
import { CascadeAI } from "./ai.js";
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
let game = null;
let selectedHandCardIds = new Set();
let targetedMeldId = null;
let turn0UiMode = "idle"; // 'idle' | 'select-swap'
let rearrangeSelectedCardId = null; // card currently picked up within an active rearrange session
let currentSeed = null; // seed behind the current game's shuffle -- displayed so a disputed game can be reproduced later (#16)
let currentRng = null; // shared across every round of one game, so the whole game (not just round 1) replays identically from the seed
// --- Drag-and-drop (#40) ---------------------------------------------------
// Touch-first: Pointer Events, not native HTML5 drag-and-drop (which has no
// real mobile browser support). A drag "arms" either on a short hold or on a
// real vertical lift -- never on pure horizontal movement alone, which would
// be indistinguishable from the user just scrolling the hand/open-row strip.
// Once armed, any direction (including horizontal) drives the drag, which is
// what makes a natural sideways slide work for hand reordering.
const HOLD_MS = 180;
const LIFT_PX = 6; // real vertical component that arms a drag before the hold fires
const AUTOSCROLL_MARGIN = 64; // px from a viewport edge that triggers autoscroll during an armed drag
const AUTOSCROLL_MAX_SPEED = 14; // px per animation frame right at the edge
let dragState = null;
let suppressNextClick = false;
let handDisplayOrder = [];
let autoScrollHandle = null;
let lastOpenRowLen = 0;
let aiDisabled = false; // only ever set via the ?test=1 hook at the bottom
function $(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing #${id}`);
    return el;
}
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
// One dialog look for everything that interrupts the player (errors,
// confirmations, round/game end): title, body text, a row of buttons. Replaces
// the browser's native alert()/confirm(), which look different on every
// platform (and in the Capacitor WebView) and block the page.
// Popups can be dragged out of the way (by their top handle or any empty part
// of the box): the round-end popup used to sit on top of the very table the
// player wanted to look at to see what had just happened.
const dialogOffsets = new WeakMap();
function resetDialogPosition(box) {
    dialogOffsets.set(box, { x: 0, y: 0 });
    box.style.transform = "";
}
function makeDraggable(box) {
    resetDialogPosition(box);
    let drag = null;
    box.addEventListener("pointerdown", (ev) => {
        if (!ev.isPrimary || ev.target.closest("button"))
            return;
        const off = dialogOffsets.get(box);
        const r = box.getBoundingClientRect();
        // Where the box sits with no offset, so the move can be kept on screen.
        const baseLeft = r.left - off.x;
        const baseTop = r.top - off.y;
        drag = {
            id: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            from: { ...off },
            minX: -baseLeft,
            maxX: window.innerWidth - baseLeft - r.width,
            minY: -baseTop,
            maxY: window.innerHeight - baseTop - r.height,
        };
        box.setPointerCapture(ev.pointerId);
    });
    box.addEventListener("pointermove", (ev) => {
        if (!drag || ev.pointerId !== drag.id)
            return;
        const x = Math.min(drag.maxX, Math.max(drag.minX, drag.from.x + ev.clientX - drag.startX));
        const y = Math.min(drag.maxY, Math.max(drag.minY, drag.from.y + ev.clientY - drag.startY));
        dialogOffsets.set(box, { x, y });
        box.style.transform = `translate(${x}px, ${y}px)`;
    });
    const end = (ev) => {
        if (drag && ev.pointerId === drag.id)
            drag = null;
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
}
function fillDialog(box, title, body, actions, close) {
    box.innerHTML = "";
    const x = document.createElement("button");
    x.className = "x-btn";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.addEventListener("click", close);
    const h = document.createElement("h3");
    h.className = "dialog-title";
    h.textContent = title;
    const p = document.createElement("p");
    p.className = "dialog-body";
    p.textContent = body;
    const row = document.createElement("div");
    row.className = "modal-actions";
    actions.forEach((a) => {
        const b = button(a.label, () => {
            close();
            a.onClick?.();
        });
        if (a.secondary)
            b.classList.add("secondary");
        row.appendChild(b);
    });
    box.append(x, h, p, row);
}
function closeDialog() {
    $("dialogRoot").hidden = true;
    $("dialogBox").innerHTML = "";
}
// Lives in its own #dialogRoot (not #modalRoot) because render() rebuilds
// #modalRoot on every state change -- an error raised mid-action would be
// wiped by the very next render.
function showDialog(title, body, actions = [{ label: "OK" }]) {
    fillDialog($("dialogBox"), title, body, actions, closeDialog);
    resetDialogPosition($("dialogBox"));
    $("dialogRoot").hidden = false;
    $("dialogBox").querySelector("button")?.focus();
}
function showError(msg) {
    showDialog("Can't do that", msg);
}
document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("dialogRoot").hidden)
        closeDialog();
});
function suitClass(card) {
    if (card.rank === "JOKER")
        return "joker";
    // Four-color deck (spades black, clubs green, hearts red, diamonds
    // blue) instead of the standard two-color deck -- requested to make
    // suits easier to tell apart at a glance during testing.
    return { S: "suit-s", C: "suit-c", H: "suit-h", D: "suit-d" }[card.suit];
}
function cardText(card) {
    if (card.rank === "JOKER")
        return "JOKER";
    return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}
function buildCardEl(card, opts = {}) {
    const el = document.createElement("div");
    el.className = `card ${suitClass(card)}`.trim();
    el.dataset.cardId = card.id;
    if (opts.ownerId !== undefined && opts.ownerId !== null)
        el.classList.add(`owner-${opts.ownerId + 1}`);
    if (opts.selected)
        el.classList.add("selected");
    if (opts.pickable)
        el.classList.add("pickable");
    if (opts.wildAs) {
        // A joker standing in for a card shows that card's rank/suit in the
        // normal corner index (so it stays readable when melds overlap) and is
        // marked as a joker by its dashed border + badge (see .card.wild).
        el.classList.add("wild");
        const rankSpan = document.createElement("span");
        rankSpan.className = "rank";
        rankSpan.textContent = opts.wildAs.rank;
        el.appendChild(rankSpan);
        if (opts.wildAs.suit) {
            const suitSpan = document.createElement("span");
            suitSpan.className = "suit";
            suitSpan.textContent = SUIT_SYMBOL[opts.wildAs.suit];
            el.appendChild(suitSpan);
        }
        el.title = `Joker standing in for ${opts.wildAs.rank}${opts.wildAs.suit ? SUIT_SYMBOL[opts.wildAs.suit] : ""}`;
    }
    else if (card.rank === "JOKER") {
        el.textContent = "JOKER";
    }
    else {
        // Rank and suit as separate elements (not one text string) so the
        // suit symbol can be sized up independently — at the original size,
        // black suits especially (♠ vs ♣, no color to tell them apart) were
        // hard to distinguish in a long, busy open row.
        const rankSpan = document.createElement("span");
        rankSpan.className = "rank";
        rankSpan.textContent = card.rank;
        const suitSpan = document.createElement("span");
        suitSpan.className = "suit";
        suitSpan.textContent = SUIT_SYMBOL[card.suit];
        el.append(rankSpan, suitSpan);
    }
    if (opts.onClick)
        el.addEventListener("click", opts.onClick);
    return el;
}
// --- Game lifecycle -------------------------------------------------------
function newGame() {
    const mode = $("modeSelect").value;
    const seedField = $("seedInput").value.trim();
    // Leave the field blank for a fresh random deal; enter a previously-shown
    // seed to replay that exact deal (shuffle + starter coin-flip) -- e.g. to
    // reproduce a disputed game from a saved number instead of screenshots.
    const seed = seedField === ""
        ? Math.floor(Math.random() * 1000000000)
        : Number(seedField);
    if (!Number.isFinite(seed)) {
        showError(`"${seedField}" isn't a valid seed -- enter a whole number, or leave it blank for a random deal.`);
        return;
    }
    currentSeed = seed;
    currentRng = CascadeEngine.seededRng(seed);
    game = CascadeEngine.newGame(mode, currentRng);
    CascadeEngine.startRound(game, currentRng);
    selectedHandCardIds.clear();
    targetedMeldId = null;
    turn0UiMode = "idle";
    handDisplayOrder = [];
    hideBalloon(); // don't carry a leftover note into the new game
    resetDialogPosition($("modalBox"));
    render();
    scheduleIfAITurn();
}
function nextRound() {
    CascadeEngine.startRound(game, currentRng ?? undefined);
    selectedHandCardIds.clear();
    targetedMeldId = null;
    turn0UiMode = "idle";
    handDisplayOrder = [];
    hideBalloon();
    resetDialogPosition($("modalBox"));
    render();
    scheduleIfAITurn();
}
function afterHumanAction() {
    render();
    scheduleIfAITurn();
}
// True only while it's genuinely the AI's move in THIS game. CascadeAI.takeTurn
// plays for whoever is current without checking, so every delayed AI move
// must re-check this when its timer fires: a timer left over from a game
// that was since restarted (or a round that moved on) would otherwise make
// the AI play the HUMAN's hand -- seen as the browser smoke test randomly
// finding its cards already melded after rapid "New Game" clicks.
function isAITurnNow(g) {
    if (aiDisabled || game !== g || !g.round || g.gameOver || g.round.ended)
        return false;
    if (g.round.part === "turn0")
        return CascadeEngine.turn0CurrentAskee(g) === 1;
    return g.round.current === 1;
}
function scheduleIfAITurn() {
    const g = game;
    if (!g || !isAITurnNow(g))
        return;
    const delay = g.round?.part === "turn0" ? 500 : 600;
    setTimeout(() => {
        if (!isAITurnNow(g))
            return;
        CascadeAI.takeTurn(g, { onStateChanged: render });
        scheduleIfAITurn();
    }, delay);
}
// --- Rendering -------------------------------------------------------------
function render() {
    if (!game)
        return;
    // Saved total, plus what this round's melds on the table are worth so far.
    [0, 1].forEach((i) => {
        const pending = game.round?.ended
            ? 0
            : CascadeEngine.roundMeldPointsSoFar(game, i);
        $(i === 0 ? "scoreP1" : "scoreP2").textContent =
            String(game.scores[i]) + (pending > 0 ? ` (+${pending})` : "");
    });
    $("roundNum").textContent = String(game.roundNumber);
    $("pileCount").textContent = String(game.round.closedPile.length);
    $("currentSeed").textContent =
        currentSeed === null ? "–" : String(currentSeed);
    renderBanner();
    renderOpenRow();
    if (game.round.rearrange) {
        renderRearrangeView();
    }
    else {
        $("rearrangeHandPoolWrap").hidden = true;
        $("tableauHint").textContent =
            "(shared — tap a series to target it for Add/Swap/Pull; drag one of your own cards out to pull it back, once you've come out)";
        renderTableau();
    }
    fitMeldOverlaps();
    renderHand();
    renderOppHand();
    renderAiHand();
    renderMenuLabels();
    renderOppStatus();
    renderControls();
    renderLog();
}
// Meld cards overlap (see .meld in style.css). A long run -- 12-13 cards --
// would still overflow a phone-width table at the default overlap, so tighten
// the overlap for just that meld until it fits, down to a floor that still
// leaves the corner index readable (past that, the tableau scrolls).
const MELD_CARD_W = 40;
const MELD_OVERLAP_DEFAULT = 16;
const MELD_OVERLAP_MAX = 22; // leaves an 18px strip
function fitMeldOverlaps() {
    const tableau = $("tableau");
    tableau.querySelectorAll(".meld").forEach((box) => {
        const wrap = box.querySelector(".meld-cards");
        if (!wrap)
            return;
        wrap.style.removeProperty("--meld-overlap");
        const n = wrap.children.length;
        if (n < 2)
            return;
        const chrome = box.offsetWidth - wrap.offsetWidth; // meld padding + border
        const avail = tableau.clientWidth - chrome;
        // total width = n*cardW - (n-1)*overlap; solve for the overlap that fits
        const needed = (n * MELD_CARD_W - avail) / (n - 1);
        const overlap = Math.min(MELD_OVERLAP_MAX, Math.max(MELD_OVERLAP_DEFAULT, needed));
        if (overlap > MELD_OVERLAP_DEFAULT)
            wrap.style.setProperty("--meld-overlap", `${overlap}px`);
    });
}
window.addEventListener("resize", () => {
    if (game)
        fitMeldOverlaps();
});
// The opponent's hand as card backs, peeking in from the top edge (Figma).
function renderOppHand() {
    const el = $("oppHand");
    el.innerHTML = "";
    const g = game;
    if (!g.round)
        return;
    for (let i = 0; i < g.round.hands[1].length; i++) {
        const back = document.createElement("div");
        back.className = "card back";
        el.appendChild(back);
    }
}
// Debug-only: shows the AI's actual hand face-up for testing. The real
// game would never reveal an opponent's hand -- this exists purely so
// the designer can see what the AI was holding when reviewing its plays.
function renderAiHand() {
    const el = $("aiHand");
    el.innerHTML = "";
    const g = game;
    if (!g.round || g.round.rearrange)
        return;
    g.round.hands[1].forEach((card) => {
        el.appendChild(buildCardEl(card));
    });
}
function renderBanner() {
    const banner = $("banner");
    banner.innerHTML = "";
    const modalRoot = $("modalRoot");
    const modalBox = $("modalBox");
    modalBox.innerHTML = "";
    modalRoot.hidden = true;
    const g = game;
    const r = g.round;
    // Round/game-end is a real interrupting event, not an inline status line
    // -- it gets the centered modal popup (fixed to the viewport, not the
    // page), not the top-of-page #banner, which was easy to scroll past and
    // mistake for the app having silently stopped responding.
    if (g.gameOver) {
        modalRoot.hidden = false;
        const who = g.winner === 0 ? "You" : "The AI";
        fillDialog(modalBox, `${who} won the game!`, `Final: you ${g.scores[0]} — them ${g.scores[1]}`, [{ label: "New game", onClick: newGame }], () => {
            modalRoot.hidden = true;
        });
        banner.hidden = true;
        return;
    }
    if (r.ended) {
        modalRoot.hidden = false;
        const rs = r.roundScores;
        // Plain recap rather than "You won": the player who goes out is not
        // always the one who scores more this round (DESIGN.md 2.8).
        fillDialog(modalBox, r.endReason === "pile-empty" ? "Round ended, pile empty" : "Round ended!", `Your score this round: ${rs[0]}\nTheir score this round: ${rs[1]}`, [
            { label: `Round ${g.roundNumber + 1}`, onClick: nextRound },
            { label: "New game", onClick: newGame, secondary: true },
        ], () => {
            modalRoot.hidden = true;
        });
        banner.hidden = true;
        return;
    }
    if (r.part === "turn0") {
        const askee = CascadeEngine.turn0CurrentAskee(g);
        if (askee === 0) {
            // Taking / declining is done by tapping the open card / the pile (see
            // toggleTurn0Take and the pile handler), explained by a hint balloon.
            banner.hidden = true;
            return;
        }
        banner.hidden = false;
        banner.appendChild(textEl("Turn 0: waiting on the AI..."));
        return;
    }
    banner.hidden = true;
}
function textEl(msg) {
    const s = document.createElement("span");
    s.textContent = msg;
    return s;
}
function button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}
// Turn 0, human's offer: tapping the open (starter) card means "swap it for a
// card from my hand" -- tap again to change your mind; tapping the pile
// declines instead.
function toggleTurn0Take() {
    turn0UiMode = turn0UiMode === "idle" ? "select-swap" : "idle";
    render();
}
// Would the picked-up card be addable to a series already on the table?
// Tried on a copy of the game so the real one is untouched.
function canAddToTableAfterTake(g, card) {
    try {
        const sim = structuredClone(g);
        CascadeEngine.drawFromOpenRow(sim, card.id);
        const simRound = sim.round;
        if (!simRound.comeOut[simRound.current])
            return false;
        return simRound.tableau.some((meld) => {
            const res = CascadeEngine.autoResolveAddToMeld(meld, card);
            if (!res)
                return false;
            try {
                CascadeEngine.addToMeld(sim, meld.id, card.id, res.wildAs);
                return true;
            }
            catch {
                return false;
            }
        });
    }
    catch {
        return false;
    }
}
function renderOpenRow() {
    const el = $("openRow");
    el.innerHTML = "";
    const g = game;
    const r = g.round;
    // Part 1, or Part 2 after a take this turn (take, lay, take again).
    const pickable = r.current === 0 && CascadeEngine.canDrawFromRow(g);
    const turn0Mine = r.part === "turn0" && CascadeEngine.turn0CurrentAskee(g) === 0;
    // Keep the newest discard in view when the row grows past the screen.
    const grew = r.openRow.length > lastOpenRowLen;
    lastOpenRowLen = r.openRow.length;
    r.openRow.forEach((card, idx) => {
        el.appendChild(buildCardEl(card, {
            pickable: pickable || (turn0Mine && idx === r.openRow.length - 1),
            onClick: turn0Mine
                ? idx === r.openRow.length - 1
                    ? toggleTurn0Take
                    : null
                : pickable
                    ? () => {
                        const hand = r.hands[0];
                        const scoopCards = r.openRow.slice(idx); // this card + everything discarded after it
                        const take = () => {
                            try {
                                CascadeEngine.drawFromOpenRow(g, card.id);
                                render();
                                if (g.round.ended)
                                    return;
                                scheduleIfAITurn();
                            }
                            catch (e) {
                                showError(errMsg(e));
                            }
                        };
                        // Only worth a warning when the pickup drags extra cards
                        // along: a lone card can simply be discarded back. And the
                        // card may also go on the table (added to an existing
                        // series), not just into a new series from the hand.
                        const extra = scoopCards.length - 1;
                        if (extra >= 1 &&
                            !CascadeAI.canResolvePickup(hand, scoopCards, card.id) &&
                            !canAddToTableAfterTake(g, card)) {
                            showDialog("Take this card anyway?", `Taking this card will also take ${extra} more ${extra === 1 ? "card" : "cards"}, and ${cardText(card)} must go on the table this turn (or be discarded back) — ` +
                                `but it doesn't seem to fit a series from your hand or an existing series on the table.`, [
                                { label: "Cancel", secondary: true },
                                { label: "Take it anyway", onClick: take },
                            ]);
                            return;
                        }
                        take();
                    }
                    : null,
        }));
    });
    if (grew)
        el.scrollLeft = el.scrollWidth;
}
function renderTableau() {
    const el = $("tableau");
    el.innerHTML = "";
    const g = game;
    const r = g.round;
    const canRearrange = r.part === 2 && r.current === 0 && !r.ended && r.comeOut[0];
    r.tableau.forEach((meld) => {
        const box = document.createElement("div");
        box.className = "meld" + (meld.id === targetedMeldId ? " targeted" : "");
        box.dataset.meldId = meld.id;
        box.addEventListener("click", () => {
            // Deliberately not a toggle: re-clicking an already-targeted meld
            // used to un-target it with no clear feedback, which was a likely
            // cause of "the button is disabled for no reason" reports. Clicking
            // a meld always (re-)targets it; use "Clear selection" to untarget.
            targetedMeldId = meld.id;
            render();
        });
        const cardsWrap = document.createElement("div");
        cardsWrap.className = "meld-cards";
        meld.slots.forEach((slot) => {
            const cardEl = buildCardEl(slot.card, {
                ownerId: slot.ownerId,
                wildAs: slot.wildAs,
                pickable: canRearrange,
            });
            // Unconditional (matches the meld border's own always-on handler):
            // tapping ANY part of a meld -- a card or the border -- targets it.
            // Pulling a card back out is now a drag-out gesture (attachDragSource
            // below), not a tap, which used to be genuinely ambiguous with the
            // joker-swap-by-tap shortcut just below.
            cardEl.addEventListener("click", (ev) => {
                ev.stopPropagation(); // don't also re-set targeting via the border handler
                // Clicking a joker with a matching hand card already selected is
                // clearly a swap-in-place attempt, not a rearrangement — do that
                // instead of just targeting the meld (which would need a second tap
                // on "Add selected card to targeted meld", except that's not even
                // the right button for a swap).
                if (slot.card.rank === "JOKER" && selectedHandCardIds.size === 1) {
                    const replacement = g.round?.hands[0].find((c) => c.id === [...selectedHandCardIds][0]);
                    const matches = replacement &&
                        slot.wildAs &&
                        replacement.rank === slot.wildAs.rank &&
                        (meld.type === "set" ||
                            replacement.suit === CascadeEngine.meldSuit(meld));
                    if (matches) {
                        try {
                            CascadeEngine.swapJoker(g, meld.id, slot.card.id, replacement.id);
                            selectedHandCardIds.clear();
                            afterHumanAction();
                        }
                        catch (e) {
                            showError(errMsg(e));
                        }
                        return;
                    }
                    // A card was selected and they clicked the joker specifically —
                    // almost certainly a swap attempt, not a rearrange. Explain the
                    // mismatch directly instead of silently falling through to just
                    // targeting the meld.
                    const suitHint = meld.type === "run"
                        ? SUIT_SYMBOL[CascadeEngine.meldSuit(meld)]
                        : "";
                    showError(`This joker stands in for ${slot.wildAs?.rank}${suitHint} — your selected ${replacement ? cardText(replacement) : "card"} doesn't match, so it can't be swapped in. If it would extend or fit this series instead, tap the series and use "Add to series."`);
                    return;
                }
                targetedMeldId = meld.id;
                render();
            });
            if (canRearrange && slot.ownerId === 0) {
                attachDragSource(cardEl, {
                    kind: "meld",
                    cardId: slot.card.id,
                    meldId: meld.id,
                    ownsCard: true,
                });
            }
            else if (r.part === 2 && r.current === 0 && !r.ended) {
                // Not pullable right now -- say why, instead of a drag that silently
                // does nothing (it read as "the game is broken").
                attachBlockedPullHint(cardEl, !r.comeOut[0]
                    ? "You can only pull cards back after you've come out (40 points or more in one turn)."
                    : `${cardText(slot.card)} counts for the AI, so you can't pull it back; you can only pull back cards you laid yourself. To regroup it anyway, use "Rearrange…".`);
            }
            cardsWrap.appendChild(cardEl);
        });
        box.appendChild(cardsWrap);
        el.appendChild(box);
    });
}
// Draft-then-commit tableau rearrange (§2.3, added 2026-07-27): renders the
// SESSION's draft groups + hand pool into the same containers renderTableau
// normally uses, entirely separate from game.round.tableau/hands until a
// successful commit. Click a card to pick it up, then click a group (or
// "Move selected to a new group" / "...to hand") to place it there.
function renderRearrangeView() {
    const g = game;
    const r = g.round;
    const rearrange = r.rearrange;
    const stillOwed = r.rowObligationCardId &&
        r.pendingObligations.includes(r.rowObligationCardId)
        ? cardText(rearrange.cardById[r.rowObligationCardId])
        : null;
    $("tableauHint").textContent = stillOwed
        ? `(drafting — nothing is final until you commit; tap a card, then tap a group -- or any card already in it -- to move it there — you still owe ${stillOwed} from the cascade this turn, so it needs to end up in a valid group, or it'll still be owed after you commit)`
        : "(drafting — nothing is final until you commit; tap a card, then tap a group -- or any card already in it -- to move it there)";
    const el = $("tableau");
    el.innerHTML = "";
    const state = CascadeEngine.rearrangeState(g);
    if (!state)
        return;
    const cardById = rearrange.cardById;
    state.groups.forEach((gr) => {
        const box = document.createElement("div");
        box.className = "meld " + (gr.valid ? "draft-valid" : "draft-invalid");
        box.title = gr.valid ? `Valid ${gr.type}` : "Not a valid set or run yet";
        box.addEventListener("click", () => {
            if (!rearrangeSelectedCardId)
                return;
            try {
                CascadeEngine.rearrangeMoveCard(g, rearrangeSelectedCardId, gr.groupId);
                rearrangeSelectedCardId = null;
                render();
            }
            catch (e) {
                showError(errMsg(e));
            }
        });
        const cardsWrap = document.createElement("div");
        cardsWrap.className = "meld-cards";
        gr.cardIds.forEach((cardId) => {
            const cardEl = buildCardEl(cardById[cardId], {
                selected: cardId === rearrangeSelectedCardId,
                pickable: true,
                // pre-existing cards keep their original owner; cards from your hand are yours
                ownerId: (rearrange.originalOwnerByCardId[cardId] ?? 0),
            });
            cardEl.addEventListener("click", (ev) => {
                ev.stopPropagation();
                // A group's own border is the intended "move it here" target, but
                // once a group holds even one card, that border shrinks to the
                // meld box's ~6px padding -- a real miss target, confirmed by a
                // live report: creating a new group with one card left almost no
                // clickable border to drop a second card onto, so the tap landed
                // on the card itself and silently dropped the pending selection
                // instead. If a DIFFERENT card is already selected, clicking any
                // card in this group now moves it here too, same as clicking the
                // group's border -- clicking the group is still "targeted", it's
                // just also reachable via any card already sitting in it.
                if (rearrangeSelectedCardId && rearrangeSelectedCardId !== cardId) {
                    try {
                        CascadeEngine.rearrangeMoveCard(g, rearrangeSelectedCardId, gr.groupId);
                        rearrangeSelectedCardId = null;
                        render();
                    }
                    catch (e) {
                        showError(errMsg(e));
                    }
                    return;
                }
                rearrangeSelectedCardId =
                    rearrangeSelectedCardId === cardId ? null : cardId;
                render();
            });
            cardsWrap.appendChild(cardEl);
        });
        box.appendChild(cardsWrap);
        el.appendChild(box);
    });
    $("rearrangeHandPoolWrap").hidden = false;
    const poolEl = $("rearrangeHandPool");
    poolEl.innerHTML = "";
    state.handPool.forEach((cardId) => {
        const cardEl = buildCardEl(cardById[cardId], {
            selected: cardId === rearrangeSelectedCardId,
            pickable: true,
            ownerId: (rearrange.originalOwnerByCardId[cardId] ?? 0),
        });
        cardEl.addEventListener("click", () => {
            rearrangeSelectedCardId =
                rearrangeSelectedCardId === cardId ? null : cardId;
            render();
        });
        poolEl.appendChild(cardEl);
    });
}
function renderHand() {
    const el = $("hand");
    el.innerHTML = "";
    const g = game;
    const r = g.round;
    if (r.rearrange)
        return; // "Your hand, in the draft" (rearrangeHandPool) stands in for this during a session
    const hand = r.hands[0]; // human is always P1
    const order = reconcileHandDisplayOrder(hand);
    const byId = new Map(hand.map((c) => [c.id, c]));
    order.forEach((cardId) => {
        const card = byId.get(cardId);
        if (!card)
            return;
        const cardEl = buildCardEl(card, {
            selected: selectedHandCardIds.has(card.id),
            onClick: () => {
                if (r.part === "turn0" &&
                    turn0UiMode === "select-swap" &&
                    CascadeEngine.turn0CurrentAskee(g) === 0) {
                    try {
                        CascadeEngine.turn0Accept(g, card.id);
                        turn0UiMode = "idle";
                        render();
                        scheduleIfAITurn();
                    }
                    catch (e) {
                        showError(errMsg(e));
                    }
                    return;
                }
                if (r.part !== 2 || r.current !== 0)
                    return;
                if (selectedHandCardIds.has(card.id))
                    selectedHandCardIds.delete(card.id);
                else
                    selectedHandCardIds.add(card.id);
                render();
            },
        });
        attachDragSource(cardEl, { kind: "hand", cardId: card.id });
        el.appendChild(cardEl);
    });
}
// --- Hand display order (#40) -----------------------------------------------
// Purely a UI concern -- the engine's hand array order isn't meaningful, so
// display order is tracked separately and reconciled against the real hand
// on every render: cards still present keep their relative order, new cards
// (drawn, picked up, taken from a swap) are appended at the end.
function reconcileHandDisplayOrder(hand) {
    const ids = new Set(hand.map((c) => c.id));
    const kept = handDisplayOrder.filter((id) => ids.has(id));
    const known = new Set(kept);
    handDisplayOrder = [
        ...kept,
        ...hand.filter((c) => !known.has(c.id)).map((c) => c.id),
    ];
    return handDisplayOrder;
}
function reorderHandCard(cardId, beforeCardId) {
    const cur = handDisplayOrder.filter((id) => id !== cardId);
    const idx = beforeCardId ? cur.indexOf(beforeCardId) : -1;
    cur.splice(idx === -1 ? cur.length : idx, 0, cardId);
    handDisplayOrder = cur;
}
// --- Drag-and-drop mechanics (#40) ------------------------------------------
// A card that can't be pulled back (the AI's, or you haven't come out yet).
// Holding it, or dragging it with a mouse, shows why. A quick swipe on touch
// is just scrolling the table, so that stays silent.
function attachBlockedPullHint(el, message) {
    el.addEventListener("pointerdown", (ev) => {
        if (!ev.isPrimary)
            return;
        const startX = ev.clientX;
        const startY = ev.clientY;
        const isTouch = ev.pointerType === "touch";
        let shown = false;
        const show = () => {
            if (shown)
                return;
            shown = true;
            showInfo(message, 6000);
            stop();
        };
        const holdTimer = setTimeout(show, HOLD_MS);
        const onMove = (m) => {
            if (Math.hypot(m.clientX - startX, m.clientY - startY) <= 10)
                return;
            if (isTouch)
                stop(); // swiping to scroll, not trying to pick the card up
            else
                show();
        };
        const stop = () => {
            clearTimeout(holdTimer);
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", stop);
        document.addEventListener("pointercancel", stop);
    });
}
function attachDragSource(el, source) {
    el.addEventListener("pointerdown", (ev) => {
        if (!ev.isPrimary || dragState !== null)
            return;
        const g = game;
        const r = g.round;
        if (r.part === "turn0")
            return; // Turn-0 guard: a plain tap must reach turn0Accept unaffected
        const rect = el.getBoundingClientRect();
        dragState = {
            pointerId: ev.pointerId,
            source,
            originEl: el,
            startX: ev.clientX,
            startY: ev.clientY,
            curX: ev.clientX,
            curY: ev.clientY,
            grabDx: ev.clientX - rect.left,
            grabDy: ev.clientY - rect.top,
            armed: false,
            holdTimer: setTimeout(() => armDrag(), HOLD_MS),
            ghostEl: null,
            hoverTarget: null,
            canPlay: r.part === 2 && r.current === 0 && !r.rearrange,
        };
    });
}
function armDrag() {
    const ds = dragState;
    if (!ds || ds.armed)
        return;
    if (ds.holdTimer)
        clearTimeout(ds.holdTimer);
    ds.holdTimer = null;
    ds.originEl.setPointerCapture(ds.pointerId);
    ds.originEl.classList.add("dragging");
    const rect = ds.originEl.getBoundingClientRect();
    const ghost = ds.originEl.cloneNode(true);
    ghost.classList.remove("dragging");
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);
    ds.ghostEl = ghost;
    ds.armed = true;
    startAutoScroll();
}
function findScrollParent(x, y) {
    let node = document.elementFromPoint(x, y);
    while (node && node !== document.body && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
            const style = getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) &&
                node.scrollHeight > node.clientHeight + 1) {
                return node;
            }
        }
        node = node.parentElement;
    }
    return (document.scrollingElement ??
        document.documentElement);
}
// Dragging near the top/bottom edge of the viewport scrolls whichever
// container is actually scrollable there (the tableau's own scroll region,
// or the page) on its own animation-frame ticks -- a pointer that's simply
// being held still at the edge generates no further pointermove events to
// react to, so without this a meld below the fold is unreachable by drag.
function autoScrollStep() {
    const ds = dragState;
    if (!ds || !ds.armed) {
        autoScrollHandle = null;
        return;
    }
    const vh = window.innerHeight;
    let dy = 0;
    if (ds.curY < AUTOSCROLL_MARGIN) {
        dy = -AUTOSCROLL_MAX_SPEED * (1 - ds.curY / AUTOSCROLL_MARGIN);
    }
    else if (ds.curY > vh - AUTOSCROLL_MARGIN) {
        dy = AUTOSCROLL_MAX_SPEED * (1 - (vh - ds.curY) / AUTOSCROLL_MARGIN);
    }
    if (dy !== 0) {
        const scrollEl = findScrollParent(ds.curX, ds.curY);
        if (scrollEl === document.documentElement ||
            scrollEl === document.scrollingElement) {
            window.scrollBy(0, dy);
        }
        else {
            scrollEl.scrollTop += dy;
        }
        if (ds.ghostEl) {
            ds.ghostEl.style.left = `${ds.curX - ds.grabDx}px`;
            ds.ghostEl.style.top = `${ds.curY - ds.grabDy}px`;
        }
        const prevTarget = ds.hoverTarget;
        const target = hitTestDrop(ds.curX, ds.curY);
        ds.hoverTarget = target;
        updateDragOverHighlight(prevTarget, target);
    }
    autoScrollHandle = requestAnimationFrame(autoScrollStep);
}
function startAutoScroll() {
    if (autoScrollHandle !== null)
        return;
    autoScrollHandle = requestAnimationFrame(autoScrollStep);
}
function stopAutoScroll() {
    if (autoScrollHandle !== null) {
        cancelAnimationFrame(autoScrollHandle);
        autoScrollHandle = null;
    }
}
function dropTargetEl(target) {
    if (!target)
        return null;
    if (target.kind === "meld") {
        return document.querySelector(`.meld[data-meld-id="${target.meldId}"]`);
    }
    if (target.kind === "open-row")
        return $("openRow");
    if (target.kind === "hand")
        return $("hand");
    return null; // tableau-empty: nothing to highlight
}
function updateDragOverHighlight(prev, next) {
    const prevEl = dropTargetEl(prev);
    const nextEl = dropTargetEl(next);
    if (prevEl && prevEl !== nextEl)
        prevEl.classList.remove("drag-over");
    if (nextEl)
        nextEl.classList.add("drag-over");
}
function hitTestDrop(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el)
        return null;
    const meldBox = el.closest(".meld[data-meld-id]");
    if (meldBox) {
        const onCard = el.closest(".meld .card[data-card-id]");
        return {
            kind: "meld",
            meldId: meldBox.dataset.meldId,
            onCardId: onCard?.dataset.cardId ?? null,
        };
    }
    if (el.closest("#tableau"))
        return { kind: "tableau-empty" };
    if (el.closest("#openRow"))
        return { kind: "open-row" };
    if (el.closest("#hand")) {
        const overCard = el.closest(".hand .card[data-card-id]");
        if (!overCard)
            return { kind: "hand", beforeCardId: null };
        const r = overCard.getBoundingClientRect();
        const before = x < r.left + r.width / 2;
        const nextEl = overCard.nextElementSibling;
        const nextId = nextEl instanceof HTMLElement ? (nextEl.dataset.cardId ?? null) : null;
        return {
            kind: "hand",
            beforeCardId: before ? (overCard.dataset.cardId ?? null) : nextId,
        };
    }
    return null;
}
function cleanupDrag(ds) {
    stopAutoScroll();
    ds.originEl.classList.remove("dragging");
    if (ds.ghostEl)
        ds.ghostEl.remove();
    updateDragOverHighlight(ds.hoverTarget, null);
}
// Adds as many of the given hand cards to an existing meld as legally
// attach, one at a time via the same addToMeld the single-card path uses --
// there's no engine-level "add several cards at once" action. Order matters
// for a run (e.g. extending 8-9-10 with 6 and 7 only works 7-then-6), so
// this retries in passes until a full pass makes no further progress,
// rather than requiring the caller (or the user) to get the order right.
function addMultipleToMeld(g, meldId, cardIds) {
    const remaining = new Set(cardIds);
    let progress = true;
    while (progress && remaining.size > 0) {
        progress = false;
        for (const id of remaining) {
            const meld = g.round?.tableau.find((m) => m.id === meldId);
            const card = g.round?.hands[0].find((c) => c.id === id);
            if (!meld || !card) {
                remaining.delete(id);
                continue;
            }
            const resolved = CascadeEngine.autoResolveAddToMeld(meld, card);
            if (!resolved)
                continue; // doesn't fit (yet) -- leave it for a later pass
            try {
                CascadeEngine.addToMeld(g, meldId, id, resolved.wildAs);
                remaining.delete(id);
                progress = true;
            }
            catch {
                remaining.delete(id); // fits the shape but an engine guard rejected it -- don't retry
            }
        }
    }
    return {
        addedCount: cardIds.length - remaining.size,
        remaining: [...remaining],
    };
}
function resolveDrop(ds) {
    const g = game;
    const r = g.round;
    const target = ds.hoverTarget;
    if (ds.source.kind === "meld") {
        if (target?.kind === "meld" && target.meldId === ds.source.meldId)
            return; // dropped back in place
        if (!ds.source.ownsCard) {
            showError("You don't have any cards of your own in this series to pull.");
            return;
        }
        try {
            CascadeEngine.pullFromMeld(g, ds.source.meldId, [ds.source.cardId]);
            afterHumanAction();
        }
        catch (e) {
            showError(errMsg(e));
        }
        return;
    }
    // hand source
    const card = r.hands[0].find((c) => c.id === ds.source.cardId);
    if (!card)
        return;
    if (target?.kind === "hand") {
        reorderHandCard(ds.source.cardId, target.beforeCardId);
        render();
        return;
    }
    if (!ds.canPlay) {
        if (target)
            showError("You can only play cards after drawing, during your own turn.");
        return; // no target and can't play -> just snap back, no message needed
    }
    // Dragging one card out of an active multi-card selection: where it
    // lands decides whether that means "lay these as a new meld" or "add all
    // of these to that meld" -- empty tableau space has no existing meld to
    // add to, so it can only mean the former; dropping ON a specific meld
    // unambiguously points at it, so it means the latter, not "ignore the
    // meld I dropped on and start a new one somewhere else instead."
    if (selectedHandCardIds.size > 1 && selectedHandCardIds.has(card.id)) {
        if (target?.kind === "tableau-empty") {
            const ids = [...selectedHandCardIds];
            const resolved = CascadeEngine.autoResolveMeld(r.hands[0], ids);
            if (!resolved.ok) {
                showError(resolved.error ?? "Not a valid series.");
                return;
            }
            try {
                CascadeEngine.layNewMeld(g, resolved.slots);
                selectedHandCardIds.clear();
                targetedMeldId = null;
                afterHumanAction();
            }
            catch (e) {
                showError(errMsg(e));
            }
            return;
        }
        if (target?.kind === "meld") {
            const ids = [...selectedHandCardIds];
            const result = addMultipleToMeld(g, target.meldId, ids);
            if (result.addedCount === 0) {
                showError("No legal spot for any of the selected cards in this series.");
                return;
            }
            const stillRemaining = new Set(result.remaining);
            for (const id of ids) {
                if (!stillRemaining.has(id))
                    selectedHandCardIds.delete(id);
            }
            afterHumanAction();
            return;
        }
    }
    if (target?.kind === "tableau-empty") {
        showError('Select 3+ cards and tap "Lay series" to start a new series — dragging one card only adds to an existing series.');
        return;
    }
    if (target?.kind === "open-row") {
        attemptDiscard(card.id);
        return;
    }
    if (target?.kind === "meld") {
        const meld = r.tableau.find((m) => m.id === target.meldId);
        if (!meld)
            return;
        const onSlot = target.onCardId
            ? meld.slots.find((s) => s.card.id === target.onCardId)
            : null;
        const matches = !!onSlot &&
            onSlot.card.rank === "JOKER" &&
            !!onSlot.wildAs &&
            card.rank === onSlot.wildAs.rank &&
            (meld.type === "set" || card.suit === CascadeEngine.meldSuit(meld));
        try {
            if (onSlot && matches) {
                CascadeEngine.swapJoker(g, meld.id, onSlot.card.id, card.id);
            }
            else {
                const resolved = CascadeEngine.autoResolveAddToMeld(meld, card);
                if (!resolved) {
                    showError("No legal spot for that card in this series.");
                    return;
                }
                CascadeEngine.addToMeld(g, meld.id, card.id, resolved.wildAs);
            }
            selectedHandCardIds.delete(card.id);
            afterHumanAction();
        }
        catch (e) {
            showError(errMsg(e));
        }
    }
    // target === null (dropped nowhere recognized): snap back, no-op.
}
document.addEventListener("pointermove", (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId)
        return;
    if (!dragState.armed) {
        // Horizontal movement never bails the hold out on its own. An earlier
        // version cancelled the drag once total movement passed a small
        // threshold before the hold timer or a vertical lift fired -- but real
        // touch input covers that distance within the very first movement
        // sample of ANY gesture, including a deliberate "pick up, slide
        // sideways" hand-reorder drag, so that heuristic cancelled reorder's
        // own natural motion before the hold timer ever got a chance to run.
        // A real vertical lift still arms immediately; otherwise the hold timer
        // (started at pointerdown) is the sole arbiter, and a quick tap+release
        // clears it before it ever fires (see the pointerup handler) -- so a
        // fast flick-to-scroll still isn't mistaken for a drag.
        dragState.curX = ev.clientX;
        dragState.curY = ev.clientY;
        const dy = ev.clientY - dragState.startY;
        if (Math.abs(dy) >= LIFT_PX) {
            armDrag();
        }
        else {
            return; // still waiting on the hold timer
        }
    }
    const ds = dragState;
    ev.preventDefault();
    ds.curX = ev.clientX;
    ds.curY = ev.clientY;
    if (ds.ghostEl) {
        ds.ghostEl.style.left = `${ev.clientX - ds.grabDx}px`;
        ds.ghostEl.style.top = `${ev.clientY - ds.grabDy}px`;
    }
    const prevTarget = ds.hoverTarget;
    const target = hitTestDrop(ev.clientX, ev.clientY);
    ds.hoverTarget = target;
    updateDragOverHighlight(prevTarget, target);
});
document.addEventListener("pointerup", (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId)
        return;
    const ds = dragState;
    dragState = null;
    if (!ds.armed) {
        if (ds.holdTimer)
            clearTimeout(ds.holdTimer);
        return; // plain tap -- let the browser's own synthetic click fire as normal
    }
    ds.originEl.releasePointerCapture(ev.pointerId);
    suppressNextClick = true;
    setTimeout(() => {
        suppressNextClick = false;
    }, 0);
    cleanupDrag(ds);
    resolveDrop(ds);
});
document.addEventListener("pointercancel", (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId)
        return;
    const ds = dragState;
    dragState = null;
    if (ds.holdTimer)
        clearTimeout(ds.holdTimer);
    if (ds.armed)
        cleanupDrag(ds); // aborted drag just snaps back, no resolveDrop
});
// Capture-phase so it runs before the drop target's own bubble-phase click
// handler (including the meld-card handler's own stopPropagation), stopping
// a completed drag's pointerup from also re-triggering the origin card's
// normal tap behavior.
document.addEventListener("click", (ev) => {
    if (suppressNextClick) {
        ev.stopPropagation();
        ev.preventDefault();
        suppressNextClick = false;
    }
}, true);
function renderControls() {
    const g = game;
    const r = g.round;
    const isHumanTurn = !g.gameOver && !r.ended && r.part !== "turn0" && r.current === 0;
    const rearranging = !!r.rearrange;
    const hand = r.hands[0];
    const selected = [...selectedHandCardIds]
        .map((id) => hand.find((c) => c.id === id))
        .filter((c) => !!c);
    const comeOut = r.comeOut[0];
    const comeOutProgress = !comeOut
        ? r.comeOutAccum[0] > 0
            ? ` (laid ${r.comeOutAccum[0]} of the 40 needed to come out; 40 or more in one turn)`
            : " (not come out yet: lay 40 or more in one turn)"
        : "";
    $("turnLabel").textContent = g.gameOver
        ? "Game over"
        : r.ended
            ? "Round over"
            : r.part === "turn0"
                ? "Turn 0 — starter exchange"
                : rearranging
                    ? `${r.current === 0 ? "Your" : "The AI's"} turn — rearranging the table (draft only, nothing final until committed)`
                    : `${r.current === 0 ? "Your" : "The AI's"} turn — ${r.part === 1 ? "draw" : r.part === 2 ? "lay series, then discard" : "discard"}${r.current === 0 ? comeOutProgress : ""}`;
    const obligEl = $("obligationLabel");
    if (isHumanTurn && !rearranging && r.pendingObligations.length > 0) {
        obligEl.hidden = false;
        // The row-take's bottom card may be discarded straight back instead of
        // melded; any other obligation (a reclaimed joker from a swap) must
        // still be melded. Label each accordingly rather than a blanket "must
        // meld" that's no longer accurate for the row card.
        const parts = r.pendingObligations.map((id) => {
            const c = hand.find((h) => h.id === id);
            const label = c ? cardText(c) : id;
            return id === r.rowObligationCardId
                ? `${label} (lay it in a series or discard it back)`
                : c?.rank === "JOKER"
                    ? "Joker (you must use it this turn)"
                    : `${label} (must lay it in a series)`;
        });
        obligEl.textContent = `Owed this turn: ${parts.join(", ")}${CascadeEngine.canUndoDraw(g) ? " (stuck? tap the undo button by your hand)" : ""}`;
    }
    else {
        obligEl.hidden = true;
    }
    const selCountEl = $("selectionCount");
    if (isHumanTurn && !rearranging && r.part === 2 && selected.length > 0) {
        selCountEl.hidden = false;
        selCountEl.textContent = `Selected: ${selected.map(cardText).join(", ")}`;
    }
    else {
        selCountEl.hidden = true;
    }
    const targetedMeld = !rearranging
        ? r.tableau.find((m) => m.id === targetedMeldId)
        : undefined;
    const targetEl = $("targetIndicator");
    if (isHumanTurn && !rearranging && r.part === 2 && targetedMeld) {
        targetEl.hidden = false;
        targetEl.textContent = `Targeted series: ${targetedMeld.slots.map((s) => cardText(s.card)).join(", ")}`;
    }
    else {
        targetEl.hidden = true;
    }
    // Normal Part 1/2 controls are all off-limits while a rearrange session
    // is open (the engine rejects them anyway — see the r.rearrange guards
    // added alongside this feature — but disabling them here avoids a round
    // trip through an error dialog for the obvious case).
    $("drawPileBtn").disabled =
        rearranging || !(isHumanTurn && CascadeEngine.canDrawFromClosedPile(g));
    $("undoDrawBtn").disabled =
        rearranging || !(isHumanTurn && CascadeEngine.canUndoDraw(g));
    $("clearSelectionBtn").disabled =
        rearranging || !(isHumanTurn && (selected.length > 0 || targetedMeldId));
    $("layMeldBtn").disabled =
        rearranging || !(isHumanTurn && r.part === 2 && selected.length >= 3);
    $("addToMeldBtn").disabled =
        rearranging ||
            !(isHumanTurn &&
                r.part === 2 &&
                comeOut &&
                selected.length >= 1 &&
                targetedMeldId);
    const targetedHasJoker = targetedMeld && targetedMeld.slots.some((s) => s.card.rank === "JOKER");
    $("swapJokerBtn").disabled =
        rearranging ||
            !(isHumanTurn &&
                r.part === 2 &&
                comeOut &&
                selected.length === 1 &&
                targetedHasJoker);
    $("pullMeldBtn").disabled =
        rearranging || !(isHumanTurn && r.part === 2 && comeOut && targetedMeldId);
    // Mirrors engine.ts's discard() legality exactly: every obligation OTHER
    // than the selected card must already be cleared, and if the selected
    // card IS itself obligated, it must be the row-take card specifically
    // (discard-eligible) rather than a reclaimed joker (meld-only).
    const selectedId = selected.length === 1 ? selected[0].id : null;
    const canDiscardSelected = selectedId !== null &&
        !r.pendingObligations.some((id) => id !== selectedId) &&
        (!r.pendingObligations.includes(selectedId) ||
            selectedId === r.rowObligationCardId);
    $("discardBtn").disabled =
        rearranging || !(isHumanTurn && r.part === 2 && canDiscardSelected);
    $("startRearrangeBtn").disabled =
        rearranging || !(isHumanTurn && CascadeEngine.canStartRearrange(g));
    // Contextual action bar: only the actions that currently apply are shown.
    for (const id of [
        "layMeldBtn",
        "addToMeldBtn",
        "swapJokerBtn",
        "pullMeldBtn",
        "startRearrangeBtn",
        "discardBtn",
        "clearSelectionBtn",
    ]) {
        const b = $(id);
        b.hidden = b.disabled;
    }
    updateBalloon(g, r, isHumanTurn, rearranging, hand);
    $("rearrangeControls").hidden = !rearranging;
    if (rearranging) {
        $("rearrangeNewGroupBtn").disabled =
            !rearrangeSelectedCardId;
        $("rearrangeToHandBtn").disabled =
            !rearrangeSelectedCardId;
    }
}
// The engine logs neutrally ("Player 1", "P2"); show it in the app's terms.
function friendlyLog(msg) {
    return msg
        .replace(/Player 1's/g, "Your")
        .replace(/Player 2's/g, "The AI's")
        .replace(/Player 1 starts/g, "You start")
        .replace(/\b(with|for|to) Player 2/g, "$1 the AI")
        .replace(/\b(with|for|to) Player 1/g, "$1 you")
        .replace(/Player 1/g, "You")
        .replace(/Player 2/g, "The AI")
        .replace(/\bP1\b/g, "you")
        .replace(/\bP2\b/g, "the AI");
}
function renderLog() {
    const el = $("log");
    el.innerHTML = "";
    game.round?.log.forEach((msg) => {
        const d = document.createElement("div");
        d.textContent = friendlyLog(msg);
        el.appendChild(d);
    });
    // Oldest first, scrolled to the bottom: the newest lines are the ones in view.
    el.scrollTop = el.scrollHeight;
}
// --- Action buttons ----------------------------------------------------
$("newGameBtn").addEventListener("click", newGame);
$("drawPileBtn").addEventListener("click", () => {
    try {
        CascadeEngine.drawFromClosedPile(game);
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("undoDrawBtn").addEventListener("click", () => {
    try {
        CascadeEngine.undoDraw(game);
        selectedHandCardIds.clear();
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("clearSelectionBtn").addEventListener("click", () => {
    selectedHandCardIds.clear();
    targetedMeldId = null;
    render();
});
$("layMeldBtn").addEventListener("click", () => {
    const hand = game.round?.hands[0];
    const ids = [...selectedHandCardIds];
    // Figure out on its own whether ANY valid set or run exists for this
    // selection, including every way a joker could stand in — no more
    // asking the player to pre-guess a specific rank.
    const resolved = CascadeEngine.autoResolveMeld(hand, ids);
    if (!resolved.ok)
        return showError(resolved.error ?? "Not a valid series.");
    try {
        CascadeEngine.layNewMeld(game, resolved.slots);
        selectedHandCardIds.clear();
        targetedMeldId = null;
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("addToMeldBtn").addEventListener("click", () => {
    // Accepts any number of selected cards, not just one -- e.g. holding 6D
    // and 7D with an 8-9-10D meld targeted adds both in one click, in
    // whichever order makes each individually legal (see addMultipleToMeld).
    const ids = [...selectedHandCardIds];
    const result = addMultipleToMeld(game, targetedMeldId, ids);
    if (result.addedCount === 0) {
        showError("No legal spot for any of the selected card(s) in this series.");
        return;
    }
    const stillRemaining = new Set(result.remaining);
    for (const id of ids) {
        if (!stillRemaining.has(id))
            selectedHandCardIds.delete(id);
    }
    afterHumanAction();
});
$("swapJokerBtn").addEventListener("click", () => {
    const meld = game.round?.tableau.find((m) => m.id === targetedMeldId);
    const jokerSlot = meld && meld.slots.find((s) => s.card.rank === "JOKER");
    if (!jokerSlot)
        return showError("Targeted series has no joker.");
    const cardId = [...selectedHandCardIds][0];
    try {
        CascadeEngine.swapJoker(game, meld.id, jokerSlot.card.id, cardId);
        selectedHandCardIds.clear();
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("pullMeldBtn").addEventListener("click", () => {
    const meld = game.round?.tableau.find((m) => m.id === targetedMeldId);
    if (!meld)
        return showError("Tap a series first.");
    // Only pull cards this player actually owns — a meld can be a mix of
    // both players' cards (either can add to any meld), but pulling is
    // restricted to what you placed yourself.
    const ownCardIds = meld.slots
        .filter((s) => s.ownerId === 0)
        .map((s) => s.card.id);
    if (ownCardIds.length === 0)
        return showError("You don't have any cards of your own in this series to pull.");
    try {
        CascadeEngine.pullFromMeld(game, meld.id, ownCardIds);
        targetedMeldId = null;
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("discardBtn").addEventListener("click", () => {
    attemptDiscard([...selectedHandCardIds][0]);
});
// Ending the turn. If the player has laid melds this turn that add up to under
// 40 and hasn't come out, the turn can't end (§2.4, 2026-10-03): ask whether to
// keep laying or take those melds back into the hand.
function attemptDiscard(cardId) {
    const g = game;
    const shortfall = CascadeEngine.comeOutShortfall(g);
    if (shortfall > 0) {
        const laid = 40 - shortfall;
        showDialog("You have to lay 40 or more", `The series you laid this turn are worth ${laid}. To come out you have to lay 40 points or more in one turn. Lay more, or take them back into your hand.`, [
            { label: "Keep laying" },
            {
                label: "Take back",
                secondary: true,
                onClick: () => {
                    try {
                        CascadeEngine.takeBackUnqualifiedMelds(g);
                        selectedHandCardIds.clear();
                        targetedMeldId = null;
                        afterHumanAction();
                    }
                    catch (e) {
                        showError(errMsg(e));
                    }
                },
            },
        ]);
        return;
    }
    try {
        CascadeEngine.discard(g, cardId);
        selectedHandCardIds.delete(cardId);
        targetedMeldId = null;
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
}
$("startRearrangeBtn").addEventListener("click", () => {
    try {
        CascadeEngine.startRearrange(game);
        selectedHandCardIds.clear();
        targetedMeldId = null;
        rearrangeSelectedCardId = null;
        render();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("rearrangeNewGroupBtn").addEventListener("click", () => {
    if (!rearrangeSelectedCardId)
        return;
    try {
        CascadeEngine.rearrangeMoveCard(game, rearrangeSelectedCardId, "new");
        rearrangeSelectedCardId = null;
        render();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("rearrangeToHandBtn").addEventListener("click", () => {
    if (!rearrangeSelectedCardId)
        return;
    try {
        CascadeEngine.rearrangeMoveCard(game, rearrangeSelectedCardId, "hand");
        rearrangeSelectedCardId = null;
        render();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
$("commitRearrangeBtn").addEventListener("click", () => {
    const result = CascadeEngine.commitRearrange(game);
    if (!result.ok) {
        const lines = result.problems.map((p) => `• ${p.error}`).join("\n");
        showError(`Can't commit yet:\n${lines}\n\nKeep adjusting, or use "Cancel rearrange" to give up and revert.`);
        return;
    }
    rearrangeSelectedCardId = null;
    afterHumanAction();
});
$("cancelRearrangeBtn").addEventListener("click", () => {
    try {
        CascadeEngine.cancelRearrange(game);
        rearrangeSelectedCardId = null;
        render();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
let balloon = null;
let infoTimer = null;
const dismissedThisSession = new Set();
const HINTS_KEY = "cascade.hintsSeen";
function hintsSeen() {
    try {
        return new Set(JSON.parse(localStorage.getItem(HINTS_KEY) ?? "[]"));
    }
    catch {
        return new Set();
    }
}
function rememberHint(key) {
    try {
        localStorage.setItem(HINTS_KEY, JSON.stringify([...hintsSeen(), key]));
    }
    catch {
        /* storage unavailable: the tip just shows again next session */
    }
}
function showBalloon(key, text, persist = false) {
    if (dismissedThisSession.has(key))
        return;
    if (persist && hintsSeen().has(key))
        return;
    balloon = { key, persist };
    $("balloonText").textContent = text;
    $("balloon").hidden = false;
}
function hideBalloon() {
    if (infoTimer)
        clearTimeout(infoTimer);
    infoTimer = null;
    balloon = null;
    $("balloon").hidden = true;
}
$("balloonClose").addEventListener("click", () => {
    if (!balloon)
        return;
    if (balloon.persist)
        rememberHint(balloon.key);
    else
        dismissedThisSession.add(balloon.key);
    if (balloon.key === "info" && infoTimer)
        clearTimeout(infoTimer);
    hideBalloon();
});
function showInfo(text, ms = 3500) {
    if (infoTimer)
        clearTimeout(infoTimer);
    dismissedThisSession.delete("info");
    showBalloon("info", text);
    infoTimer = setTimeout(() => {
        if (balloon?.key === "info")
            hideBalloon();
        infoTimer = null;
    }, ms);
}
function updateBalloon(g, r, isHumanTurn, rearranging, hand) {
    if (balloon?.key === "info")
        return; // a "why not" note is on screen
    if (r.part === "turn0" && !g.gameOver) {
        const mine = CascadeEngine.turn0CurrentAskee(g) === 0;
        const want = !mine
            ? null
            : turn0UiMode === "idle"
                ? {
                    key: "hint-turn0",
                    persist: true,
                    text: "Turn 0: tap the open card to swap it for a card from your hand, or tap the pile to decline.",
                }
                : {
                    key: "turn0-place",
                    persist: false,
                    text: "Now tap the card from your hand to put on the cascade.",
                };
        if (balloon && balloon.key !== want?.key)
            hideBalloon();
        if (want)
            showBalloon(want.key, want.text, want.persist);
        return;
    }
    if (isHumanTurn && !rearranging && r.pendingObligations.length > 0) {
        const parts = r.pendingObligations.map((id) => {
            const c = hand.find((h) => h.id === id);
            const label = c ? cardText(c) : id;
            return id === r.rowObligationCardId
                ? `lay ${label} in a series or discard it back`
                : c?.rank === "JOKER"
                    ? "use this joker in this turn"
                    : `lay ${label} in a series`;
        });
        showBalloon(`obligation:${r.pendingObligations.join(",")}`, `You must ${parts.join(" and ")}`);
        return;
    }
    if (balloon && !balloon.persist)
        hideBalloon(); // obligation resolved
    if (g.gameOver || r.ended || !isHumanTurn || rearranging) {
        if (balloon?.persist)
            hideBalloon();
        return;
    }
    if (r.part === 1) {
        showBalloon("hint-draw", "Tap the pile to draw, or tap a card in the cascade to take it and everything on top.", true);
    }
    else if (r.part === 2) {
        showBalloon("hint-play", "Drag cards to the table to lay a series, or onto the cascade to discard.", true);
    }
}
// --- Menu ----------------------------------------------------------------------
const DEBUG_KEY = "cascade.debug";
function debugOn() {
    try {
        return localStorage.getItem(DEBUG_KEY) === "1";
    }
    catch {
        return false;
    }
}
function setDebug(on) {
    try {
        localStorage.setItem(DEBUG_KEY, on ? "1" : "0");
    }
    catch {
        /* storage unavailable: the debug view lasts until reload */
    }
    $("debugPanel").hidden = !on;
    renderMenuLabels();
}
// Whether the opponent has come out (laid 40+ in a turn). Their progress
// can't be seen between turns any more -- under 40 can't be left on the table
// (§2.4, 2026-10-03) -- so only "out" is shown.
function renderOppStatus() {
    const r = game.round;
    const el = $("oppStatus");
    el.hidden = !r || r.ended || !r.comeOut[1];
    if (!el.hidden)
        el.textContent = "out";
}
function renderMenuLabels() {
    const g = game;
    if (!g)
        return;
    $("menuRoundBtn").textContent = `Round ${g.roundNumber + 1}`;
    $("menuGoalBtn").textContent = `Goal ${g.mode === "quick" ? 300 : 1000}`;
    $("menuDebugBtn").textContent = `Debug: ${debugOn() ? "on" : "off"}`;
}
function closeMenu() {
    $("menuPop").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
}
$("menuBtn").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = $("menuPop").hidden;
    $("menuPop").hidden = !open;
    $("menuBtn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (ev) => {
    if (!$("menuPop").hidden && !ev.target.closest("#menuPop"))
        closeMenu();
});
document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape")
        closeMenu();
});
function confirmThen(title, body, label, go) {
    showDialog(title, body, [
        { label: "Cancel", secondary: true },
        { label, onClick: go },
    ]);
}
$("menuNewBtn").addEventListener("click", () => {
    closeMenu();
    const g = game;
    if (g.gameOver || g.round.ended)
        return newGame();
    confirmThen("Start a new game?", "The game in progress will be lost.", "New game", newGame);
});
$("menuRoundBtn").addEventListener("click", () => {
    closeMenu();
    const g = game;
    if (g.gameOver)
        return newGame();
    if (g.round.ended)
        return nextRound();
    confirmThen(`Skip to round ${g.roundNumber + 1}?`, "The current round is abandoned without scoring.", `Round ${g.roundNumber + 1}`, nextRound);
});
$("menuGoalBtn").addEventListener("click", () => {
    closeMenu();
    const pick = (mode) => () => {
        $("modeSelect").value = mode;
        newGame();
    };
    showDialog("Game goal", "First to pass the goal wins. Changing it starts a new game.", [
        { label: "300", onClick: pick("quick"), secondary: true },
        { label: "1000", onClick: pick("standard") },
    ]);
});
$("menuHelpBtn").addEventListener("click", () => {
    closeMenu();
    // Wording follows the Figma file: pile, cascade, table, hand, round, turn,
    // game ("series" for a laid set or run).
    showDialog("How to play", [
        "Each turn: draw, lay series on the table, then discard.",
        "Draw: tap the pile for its top card, or tap a card in the cascade to take it and every card on top of it. You can lay series and then take more from the cascade, as long as you did not draw from the pile.",
        "Lay: put 3 or more cards on the table as a series (the same number in different suits, or a run in one suit). To come out, the series you lay in one turn must be worth 40 points or more (ace 25, 10-K 10, 2-9 5, joker 50). If they are worth less, you can lay more or take them back.",
        "Moving cards: drag back a series card you laid yourself (an end card of a run, or any card that leaves a valid series). To regroup any card on the table, even the AI's, use Rearrange… as long as every series is valid when you commit.",
        "Points: the coloured bar at the bottom of each card shows who scores it: orange for you, blue for the AI (the same colours as the scores). If you swap a joker out of the AI's series, your replacement card stays with the AI; the joker is yours to play.",
        "Discard: drag a card onto the cascade to end your turn. Whoever empties their hand first ends the round. The first player past the goal (menu) wins the game.",
    ].join("\n\n"));
});
$("menuDebugBtn").addEventListener("click", () => {
    closeMenu();
    setDebug(!debugOn());
});
// Tap the closed pile to draw (Figma: no 'draw' button).
$("pileBtn").addEventListener("click", () => {
    const g = game;
    const r = g.round;
    if (!g.gameOver && !r.ended && r.part === "turn0") {
        if (CascadeEngine.turn0CurrentAskee(g) !== 0)
            return showInfo("Wait for the AI's turn.");
        if (turn0UiMode === "select-swap")
            return showInfo("Tap a card from your hand to put on the cascade, or tap the open card again to cancel.");
        CascadeEngine.turn0Decline(g);
        render();
        scheduleIfAITurn();
        return;
    }
    const draw = $("drawPileBtn");
    if (!draw.disabled) {
        draw.click();
        return;
    }
    if (g.gameOver || r.ended)
        return;
    if (r.current !== 0)
        return showInfo("Wait for the AI's turn.");
    if (r.rearrange)
        return showInfo("Finish or cancel the rearrange first.");
    showInfo("You can't draw from the pile right now.");
});
// Browser-test hook (tests/layout_large_hand.js): with ?test=1 the page
// exposes its game state and render(), and can switch the AI off, so a test
// can build an extreme position (a 30-card hand, a 13-card run) directly
// instead of hoping random play reaches one. Absent from normal use.
if (new URLSearchParams(location.search).has("test")) {
    window.__cascadeTest = {
        getGame: () => game,
        turn0Askee: () => CascadeEngine.turn0CurrentAskee(game),
        render,
        disableAI: () => {
            aiDisabled = true;
        },
    };
}
// --- Startup splash + version --------------------------------------------------
// The version is "0.<last merged PR>" (scripts/write-version.mjs writes
// docs/version.json at build time). The splash (index.html) fades out by CSS
// after 2 seconds; this removes it for good and fills in the version.
async function showVersion() {
    let label = "dev build";
    try {
        const res = await fetch("version.json", { cache: "no-store" });
        const info = (await res.json());
        // "dev" is what the build script writes when there is no merged PR
        // to number the build after (e.g. a PR-branch build in CI).
        if (info.version && info.version !== "dev")
            label = info.version;
    }
    catch {
        /* no version.json (e.g. a plain checkout): leave the dev label */
    }
    for (const id of ["splashVersion", "menuVersion"]) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = id === "menuVersion" ? `Version ${label}` : label;
    }
}
const splash = document.getElementById("splash");
if (new URLSearchParams(location.search).has("test")) {
    splash?.remove();
}
else if (splash) {
    splash.addEventListener("click", () => splash.remove());
    setTimeout(() => splash.remove(), 2500);
}
void showVersion();
makeDraggable($("modalBox"));
makeDraggable($("dialogBox"));
$("debugPanel").hidden = !debugOn();
newGame();
