// Cascade Sevens — UI controller. Hotseat human (P1) vs simple AI (P2).
// Wires DOM events to CascadeEngine calls; no rules logic lives here.

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

let game = null;
let selectedHandCardIds = new Set();
let targetedMeldId = null;
let turn0UiMode = 'idle'; // 'idle' | 'select-swap'

const $ = (id) => document.getElementById(id);

function showError(msg) {
  alert(msg);
}

function suitClass(card) {
  if (card.rank === 'JOKER') return 'joker';
  return card.suit === 'H' || card.suit === 'D' ? 'red' : '';
}

function cardText(card) {
  if (card.rank === 'JOKER') return 'JOKER';
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function buildCardEl(card, opts = {}) {
  const el = document.createElement('div');
  el.className = `card ${suitClass(card)}`.trim();
  if (opts.ownerId !== undefined && opts.ownerId !== null) el.classList.add(`owner-${opts.ownerId + 1}`);
  if (opts.selected) el.classList.add('selected');
  if (opts.pickable) el.classList.add('pickable');
  let label = cardText(card);
  if (opts.wildAs) label = `J→${opts.wildAs.rank}${opts.wildAs.suit ? SUIT_SYMBOL[opts.wildAs.suit] : ''}`;
  el.textContent = label;
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

// --- Game lifecycle -------------------------------------------------------

function newGame() {
  const mode = $('modeSelect').value;
  game = CascadeEngine.newGame(mode);
  CascadeEngine.startRound(game);
  selectedHandCardIds.clear();
  targetedMeldId = null;
  turn0UiMode = 'idle';
  render();
  scheduleIfAITurn();
}

function nextRound() {
  CascadeEngine.startRound(game);
  selectedHandCardIds.clear();
  targetedMeldId = null;
  turn0UiMode = 'idle';
  render();
  scheduleIfAITurn();
}

function afterHumanAction() {
  render();
  scheduleIfAITurn();
}

function scheduleIfAITurn() {
  if (!game || !game.round || game.gameOver || game.round.ended) return;
  const r = game.round;
  if (r.part === 'turn0') {
    if (CascadeEngine.turn0CurrentAskee(game) === 1) {
      setTimeout(() => {
        CascadeAI.takeTurn(game, { onStateChanged: render });
        scheduleIfAITurn();
      }, 500);
    }
    return;
  }
  if (r.current === 1) {
    setTimeout(() => {
      CascadeAI.takeTurn(game, { onStateChanged: render });
      scheduleIfAITurn();
    }, 600);
  }
}

// --- Rendering -------------------------------------------------------------

function render() {
  if (!game) return;
  $('scoreP1').textContent = CascadeEngine.liveScore(game, 0);
  $('scoreP2').textContent = CascadeEngine.liveScore(game, 1);
  $('roundNum').textContent = game.roundNumber;
  $('pileCount').textContent = game.round.closedPile.length;

  renderBanner();
  renderOpenRow();
  renderTableau();
  renderHand();
  renderControls();
  renderLog();
}

function renderBanner() {
  const banner = $('banner');
  banner.innerHTML = '';
  const r = game.round;

  if (game.gameOver) {
    banner.hidden = false;
    const who = game.winner === 0 ? 'You' : 'The AI';
    banner.appendChild(textEl(`${who} won the game! Final: P1 ${game.scores[0]} — P2 ${game.scores[1]}.`));
    banner.appendChild(button('Start New Game', newGame));
    return;
  }

  if (r.ended) {
    banner.hidden = false;
    const rs = r.roundScores;
    let msg = `Round ${game.roundNumber} over (${r.endReason}). `;
    msg += r.roundWinner !== null ? `Player ${r.roundWinner + 1} won the round. ` : 'Closed pile ran out. ';
    msg += `Round scores — P1 ${rs[0]}, P2 ${rs[1]}.`;
    banner.appendChild(textEl(msg));
    banner.appendChild(button('Next Round', nextRound));
    return;
  }

  if (r.part === 'turn0') {
    const askee = CascadeEngine.turn0CurrentAskee(game);
    if (askee === 0) {
      banner.hidden = false;
      const starter = r.openRow[r.openRow.length - 1];
      if (turn0UiMode === 'idle') {
        banner.appendChild(textEl(`Turn 0: take the starter card (${cardText(starter)}) into your hand?`));
        banner.appendChild(button('Take', () => { turn0UiMode = 'select-swap'; render(); }));
        banner.appendChild(button('Decline', () => { CascadeEngine.turn0Decline(game); render(); scheduleIfAITurn(); }));
      } else {
        banner.appendChild(textEl('Click a card in your hand below to place it onto the row.'));
      }
      return;
    }
    banner.hidden = false;
    banner.appendChild(textEl('Turn 0: waiting on the AI...'));
    return;
  }

  banner.hidden = true;
}

function textEl(msg) {
  const s = document.createElement('span');
  s.textContent = msg;
  return s;
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderOpenRow() {
  const el = $('openRow');
  el.innerHTML = '';
  const r = game.round;
  const pickable = r.part === 1 && r.current === 0 && r.part !== 'turn0' && CascadeEngine.canDrawFromRow(game);
  r.openRow.forEach((card, idx) => {
    el.appendChild(
      buildCardEl(card, {
        pickable,
        onClick: pickable
          ? () => {
              const hand = r.hands[0];
              const scoopCards = r.openRow.slice(idx); // this card + everything discarded after it
              if (!CascadeAI.canResolvePickup(hand, scoopCards, card.id)) {
                const scoop = scoopCards.length;
                const ok = window.confirm(
                  `Taking this card would also scoop ${scoop} card(s), and ${cardText(card)} must be melded this turn — ` +
                  `but no legal meld for it seems possible with your current hand. Take it anyway?`
                );
                if (!ok) return;
              }
              try {
                CascadeEngine.drawFromOpenRow(game, card.id);
                render();
                if (game.round.ended) return;
                scheduleIfAITurn();
              } catch (e) {
                showError(e.message);
              }
            }
          : null,
      })
    );
  });
}

function renderTableau() {
  const el = $('tableau');
  el.innerHTML = '';
  const r = game.round;
  const canRearrange = r.part === 2 && r.current === 0 && !r.ended && r.comeOut[0];
  r.tableau.forEach((meld) => {
    const box = document.createElement('div');
    box.className = 'meld' + (meld.id === targetedMeldId ? ' targeted' : '');
    box.addEventListener('click', () => {
      // Deliberately not a toggle: re-clicking an already-targeted meld
      // used to un-target it with no clear feedback, which was a likely
      // cause of "the button is disabled for no reason" reports. Clicking
      // a meld always (re-)targets it; use "Clear selection" to untarget.
      targetedMeldId = meld.id;
      render();
    });
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'meld-cards';
    meld.slots.forEach((slot) => {
      const cardEl = buildCardEl(slot.card, { ownerId: slot.ownerId, wildAs: slot.wildAs, pickable: canRearrange });
      if (canRearrange) {
        cardEl.addEventListener('click', (ev) => {
          ev.stopPropagation(); // don't also toggle meld targeting
          // Clicking a joker with a matching hand card already selected is
          // clearly a swap-in-place attempt, not a rearrangement — do that
          // instead of a pull (which would just reject it for a joker
          // filling a run's internal gap, since removing it alone breaks
          // the run; a swap replaces it atomically instead).
          if (slot.card.rank === 'JOKER' && selectedHandCardIds.size === 1) {
            const replacement = game.round.hands[0].find((c) => c.id === [...selectedHandCardIds][0]);
            const matches =
              replacement &&
              slot.wildAs &&
              replacement.rank === slot.wildAs.rank &&
              (meld.type === 'set' || replacement.suit === CascadeEngine.meldSuit(meld));
            if (matches) {
              try {
                CascadeEngine.swapJoker(game, meld.id, slot.card.id, replacement.id);
                selectedHandCardIds.clear();
                afterHumanAction();
              } catch (e) {
                showError(e.message);
              }
              return;
            }
          }
          try {
            CascadeEngine.pullFromMeld(game, meld.id, [slot.card.id]);
            afterHumanAction();
          } catch (e) {
            showError(e.message);
          }
        });
      }
      cardsWrap.appendChild(cardEl);
    });
    box.appendChild(cardsWrap);
    el.appendChild(box);
  });
}

function renderHand() {
  const el = $('hand');
  el.innerHTML = '';
  const r = game.round;
  const hand = r.hands[0]; // human is always P1

  hand.forEach((card) => {
    el.appendChild(
      buildCardEl(card, {
        selected: selectedHandCardIds.has(card.id),
        onClick: () => {
          if (r.part === 'turn0' && turn0UiMode === 'select-swap' && CascadeEngine.turn0CurrentAskee(game) === 0) {
            try {
              CascadeEngine.turn0Accept(game, card.id);
              turn0UiMode = 'idle';
              render();
              scheduleIfAITurn();
            } catch (e) {
              showError(e.message);
            }
            return;
          }
          if (r.part !== 2 || r.current !== 0) return;
          if (selectedHandCardIds.has(card.id)) selectedHandCardIds.delete(card.id);
          else selectedHandCardIds.add(card.id);
          render();
        },
      })
    );
  });
}

function renderControls() {
  const r = game.round;
  const isHumanTurn = !game.gameOver && !r.ended && r.part !== 'turn0' && r.current === 0;
  const hand = r.hands[0];
  const selected = [...selectedHandCardIds].map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  const comeOut = r.comeOut[0];

  const comeOutProgress = !comeOut && r.comeOutAccum[0] > 0 ? ` (come-out progress: ${r.comeOutAccum[0]}/40, carries forward until you cross it)` : comeOut ? '' : ' (not come out yet)';
  $('turnLabel').textContent = game.gameOver
    ? 'Game over'
    : r.ended
    ? 'Round over'
    : r.part === 'turn0'
    ? 'Turn 0 — starter exchange'
    : `Player ${r.current + 1}'s turn — Part ${r.part}${r.current === 0 ? comeOutProgress : ''}`;

  const obligEl = $('obligationLabel');
  if (isHumanTurn && r.pendingObligations.length > 0) {
    obligEl.hidden = false;
    const names = r.pendingObligations.map((id) => {
      const c = hand.find((h) => h.id === id);
      return c ? cardText(c) : id;
    });
    obligEl.textContent = `Must meld: ${names.join(', ')}${CascadeEngine.canUndoDraw(game) ? ' (stuck? use "Undo pickup")' : ''}`;
  } else {
    obligEl.hidden = true;
  }

  const selCountEl = $('selectionCount');
  if (isHumanTurn && r.part === 2 && selected.length > 0) {
    selCountEl.hidden = false;
    selCountEl.textContent = `Selected: ${selected.map(cardText).join(', ')}`;
  } else {
    selCountEl.hidden = true;
  }

  const targetedMeld = r.tableau.find((m) => m.id === targetedMeldId);
  const targetEl = $('targetIndicator');
  if (isHumanTurn && r.part === 2 && targetedMeld) {
    targetEl.hidden = false;
    targetEl.textContent = `Targeted meld: ${targetedMeld.slots.map((s) => cardText(s.card)).join(', ')}`;
  } else {
    targetEl.hidden = true;
  }

  $('drawPileBtn').disabled = !(isHumanTurn && CascadeEngine.canDrawFromClosedPile(game));
  $('finishDrawingBtn').disabled = !(isHumanTurn && CascadeEngine.canFinishDrawing(game));
  $('undoDrawBtn').disabled = !(isHumanTurn && CascadeEngine.canUndoDraw(game));
  $('clearSelectionBtn').disabled = !(isHumanTurn && (selected.length > 0 || targetedMeldId));
  $('layMeldBtn').disabled = !(isHumanTurn && r.part === 2 && selected.length >= 3);
  $('addToMeldBtn').disabled = !(isHumanTurn && r.part === 2 && comeOut && selected.length === 1 && targetedMeldId);
  const targetedHasJoker = targetedMeld && targetedMeld.slots.some((s) => s.card.rank === 'JOKER');
  $('swapJokerBtn').disabled = !(isHumanTurn && r.part === 2 && comeOut && selected.length === 1 && targetedHasJoker);
  $('pullMeldBtn').disabled = !(isHumanTurn && r.part === 2 && comeOut && targetedMeldId);
  $('discardBtn').disabled = !(isHumanTurn && r.part === 2 && r.pendingObligations.length === 0 && selected.length === 1);
}

function renderLog() {
  const el = $('log');
  el.innerHTML = '';
  game.round.log.forEach((msg) => {
    const d = document.createElement('div');
    d.textContent = msg;
    el.appendChild(d);
  });
}

// --- Action buttons ----------------------------------------------------

$('newGameBtn').addEventListener('click', newGame);

$('drawPileBtn').addEventListener('click', () => {
  try {
    CascadeEngine.drawFromClosedPile(game);
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('undoDrawBtn').addEventListener('click', () => {
  try {
    CascadeEngine.undoDraw(game);
    selectedHandCardIds.clear();
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('finishDrawingBtn').addEventListener('click', () => {
  try {
    CascadeEngine.finishDrawing(game);
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('clearSelectionBtn').addEventListener('click', () => {
  selectedHandCardIds.clear();
  targetedMeldId = null;
  render();
});

$('layMeldBtn').addEventListener('click', () => {
  const hand = game.round.hands[0];
  const ids = [...selectedHandCardIds];
  // Figure out on its own whether ANY valid set or run exists for this
  // selection, including every way a joker could stand in — no more
  // asking the player to pre-guess a specific rank.
  const resolved = CascadeEngine.autoResolveMeld(hand, ids);
  if (!resolved.ok) return showError(resolved.error);
  try {
    CascadeEngine.layNewMeld(game, resolved.slots);
    selectedHandCardIds.clear();
    targetedMeldId = null;
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('addToMeldBtn').addEventListener('click', () => {
  const hand = game.round.hands[0];
  const cardId = [...selectedHandCardIds][0];
  const card = hand.find((c) => c.id === cardId);
  const meld = game.round.tableau.find((m) => m.id === targetedMeldId);
  const resolved = CascadeEngine.autoResolveAddToMeld(meld, card);
  if (!resolved) return showError('No legal spot for that joker in this meld.');
  try {
    CascadeEngine.addToMeld(game, targetedMeldId, cardId, resolved.wildAs);
    selectedHandCardIds.clear();
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('swapJokerBtn').addEventListener('click', () => {
  const meld = game.round.tableau.find((m) => m.id === targetedMeldId);
  const jokerSlot = meld && meld.slots.find((s) => s.card.rank === 'JOKER');
  if (!jokerSlot) return showError('Targeted meld has no joker.');
  const cardId = [...selectedHandCardIds][0];
  try {
    CascadeEngine.swapJoker(game, meld.id, jokerSlot.card.id, cardId);
    selectedHandCardIds.clear();
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('pullMeldBtn').addEventListener('click', () => {
  const meld = game.round.tableau.find((m) => m.id === targetedMeldId);
  if (!meld) return showError('Target a meld first.');
  // Only pull cards this player actually owns — a meld can be a mix of
  // both players' cards (either can add to any meld), but pulling is
  // restricted to what you placed yourself.
  const ownCardIds = meld.slots.filter((s) => s.ownerId === 0).map((s) => s.card.id);
  if (ownCardIds.length === 0) return showError("You don't have any cards of your own in this meld to pull.");
  try {
    CascadeEngine.pullFromMeld(game, meld.id, ownCardIds);
    targetedMeldId = null;
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

$('discardBtn').addEventListener('click', () => {
  const cardId = [...selectedHandCardIds][0];
  try {
    CascadeEngine.discard(game, cardId);
    selectedHandCardIds.clear();
    targetedMeldId = null;
    afterHumanAction();
  } catch (e) {
    showError(e.message);
  }
});

newGame();
