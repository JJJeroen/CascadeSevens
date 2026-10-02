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
function fillDialog(box, title, body, actions, close) {
    box.innerHTML = "";
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
    box.append(h, p, row);
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
    render();
    scheduleIfAITurn();
}
function nextRound() {
    CascadeEngine.startRound(game, currentRng ?? undefined);
    selectedHandCardIds.clear();
    targetedMeldId = null;
    turn0UiMode = "idle";
    handDisplayOrder = [];
    render();
    scheduleIfAITurn();
}
function afterHumanAction() {
    render();
    scheduleIfAITurn();
}
function scheduleIfAITurn() {
    if (aiDisabled || !game || !game.round || game.gameOver || game.round.ended)
        return;
    const r = game.round;
    if (r.part === "turn0") {
        if (CascadeEngine.turn0CurrentAskee(game) === 1) {
            setTimeout(() => {
                if (aiDisabled)
                    return;
                CascadeAI.takeTurn(game, { onStateChanged: render });
                scheduleIfAITurn();
            }, 500);
        }
        return;
    }
    if (r.current === 1) {
        setTimeout(() => {
            if (aiDisabled)
                return;
            CascadeAI.takeTurn(game, { onStateChanged: render });
            scheduleIfAITurn();
        }, 600);
    }
}
// --- Rendering -------------------------------------------------------------
function render() {
    if (!game)
        return;
    $("scoreP1").textContent = String(CascadeEngine.liveScore(game, 0));
    $("scoreP2").textContent = String(CascadeEngine.liveScore(game, 1));
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
            "(shared — click a meld's border to target it for Add/Swap/Pull-entire; click a card inside it to pull just that card, once you've come out)";
        renderTableau();
    }
    fitMeldOverlaps();
    renderHand();
    renderAiHand();
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
        fillDialog(modalBox, `${who} won the game!`, `Final: P1 ${g.scores[0]} — P2 ${g.scores[1]}.`, [{ label: "Start New Game", onClick: newGame }], () => { });
        banner.hidden = true;
        return;
    }
    if (r.ended) {
        modalRoot.hidden = false;
        const rs = r.roundScores;
        let msg = r.roundWinner !== null
            ? `Player ${r.roundWinner + 1} won the round. `
            : "Closed pile ran out. ";
        msg += `Round scores — P1 ${rs[0]}, P2 ${rs[1]}.`;
        fillDialog(modalBox, `Round ${g.roundNumber} over (${r.endReason})`, msg, [{ label: "Next Round", onClick: nextRound }], () => { });
        banner.hidden = true;
        return;
    }
    if (r.part === "turn0") {
        const askee = CascadeEngine.turn0CurrentAskee(g);
        if (askee === 0) {
            banner.hidden = false;
            const starter = r.openRow[r.openRow.length - 1];
            if (turn0UiMode === "idle") {
                banner.appendChild(textEl(`Turn 0: take the starter card (${cardText(starter)}) into your hand?`));
                banner.appendChild(button("Take", () => {
                    turn0UiMode = "select-swap";
                    render();
                }));
                banner.appendChild(button("Decline", () => {
                    CascadeEngine.turn0Decline(g);
                    render();
                    scheduleIfAITurn();
                }));
            }
            else {
                banner.appendChild(textEl("Click a card in your hand below to place it onto the row."));
            }
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
function renderOpenRow() {
    const el = $("openRow");
    el.innerHTML = "";
    const g = game;
    const r = g.round;
    const pickable = r.part === 1 && r.current === 0 && CascadeEngine.canDrawFromRow(g);
    r.openRow.forEach((card, idx) => {
        el.appendChild(buildCardEl(card, {
            pickable,
            onClick: pickable
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
                    if (!CascadeAI.canResolvePickup(hand, scoopCards, card.id)) {
                        const scoop = scoopCards.length;
                        showDialog("Take this card anyway?", `Taking this card would also scoop ${scoop} card(s), and ${cardText(card)} must be melded this turn — ` +
                            `but no legal meld for it seems possible with your current hand.`, [
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
                    showError(`This joker stands in for ${slot.wildAs?.rank}${suitHint} — your selected ${replacement ? cardText(replacement) : "card"} doesn't match, so it can't be swapped in. If it would extend or fit this meld instead, target the meld's border and use "Add selected card to targeted meld."`);
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
        ? `(drafting — nothing is final until you commit; click a card, then click a group -- or any card already in it -- to move it there — you still owe ${stillOwed} from the row this turn, so it needs to end up in a valid group, or it'll still be owed after you commit)`
        : "(drafting — nothing is final until you commit; click a card, then click a group -- or any card already in it -- to move it there)";
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
            showError("You don't have any cards of your own in this meld to pull.");
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
            showError("You can only play a card during Part 2 of your own turn.");
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
                showError(resolved.error ?? "Not a valid meld.");
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
                showError("No legal spot for any of the selected cards in this meld.");
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
        showError('Select 3+ cards and use "Lay new meld" to start a new meld — dragging one card only adds to an existing meld.');
        return;
    }
    if (target?.kind === "open-row") {
        try {
            CascadeEngine.discard(g, card.id);
            selectedHandCardIds.delete(card.id);
            targetedMeldId = null;
            afterHumanAction();
        }
        catch (e) {
            showError(errMsg(e));
        }
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
                    showError("No legal spot for that card in this meld.");
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
            ? ` (come-out progress: ${r.comeOutAccum[0]}/40, carries forward until you cross it)`
            : " (not come out yet)"
        : "";
    $("turnLabel").textContent = g.gameOver
        ? "Game over"
        : r.ended
            ? "Round over"
            : r.part === "turn0"
                ? "Turn 0 — starter exchange"
                : rearranging
                    ? `Player ${r.current + 1}'s turn — rearranging the tableau (draft only, nothing final until committed)`
                    : `Player ${r.current + 1}'s turn — Part ${r.part}${r.current === 0 ? comeOutProgress : ""}`;
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
                ? `${label} (meld it or discard it back)`
                : `${label} (must meld)`;
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
        targetEl.textContent = `Targeted meld: ${targetedMeld.slots.map((s) => cardText(s.card)).join(", ")}`;
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
    $("finishDrawingBtn").disabled =
        rearranging || !(isHumanTurn && CascadeEngine.canFinishDrawing(g));
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
    $("rearrangeControls").hidden = !rearranging;
    if (rearranging) {
        $("rearrangeNewGroupBtn").disabled =
            !rearrangeSelectedCardId;
        $("rearrangeToHandBtn").disabled =
            !rearrangeSelectedCardId;
    }
}
function renderLog() {
    const el = $("log");
    el.innerHTML = "";
    game.round?.log.forEach((msg) => {
        const d = document.createElement("div");
        d.textContent = msg;
        el.appendChild(d);
    });
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
$("finishDrawingBtn").addEventListener("click", () => {
    try {
        CascadeEngine.finishDrawing(game);
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
        return showError(resolved.error ?? "Not a valid meld.");
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
        showError("No legal spot for any of the selected card(s) in this meld.");
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
        return showError("Targeted meld has no joker.");
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
        return showError("Target a meld first.");
    // Only pull cards this player actually owns — a meld can be a mix of
    // both players' cards (either can add to any meld), but pulling is
    // restricted to what you placed yourself.
    const ownCardIds = meld.slots
        .filter((s) => s.ownerId === 0)
        .map((s) => s.card.id);
    if (ownCardIds.length === 0)
        return showError("You don't have any cards of your own in this meld to pull.");
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
    const cardId = [...selectedHandCardIds][0];
    try {
        CascadeEngine.discard(game, cardId);
        selectedHandCardIds.clear();
        targetedMeldId = null;
        afterHumanAction();
    }
    catch (e) {
        showError(errMsg(e));
    }
});
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
// Browser-test hook (tests/layout_large_hand.js): with ?test=1 the page
// exposes its game state and render(), and can switch the AI off, so a test
// can build an extreme position (a 30-card hand, a 13-card run) directly
// instead of hoping random play reaches one. Absent from normal use.
if (new URLSearchParams(location.search).has("test")) {
    window.__cascadeTest = {
        getGame: () => game,
        render,
        disableAI: () => {
            aiDisabled = true;
        },
    };
}
newGame();
