// Cascade Sevens — UI controller. Hotseat human (P1) vs simple AI (P2).
// Wires DOM events to CascadeEngine calls; no rules logic lives here.

const RANKS_UI = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
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

function promptRank(question) {
  while (true) {
    const v = window.prompt(`${question}\n(A, 2-10, J, Q, K — Cancel to abort)`);
    if (v === null) return null;
    const val = v.trim().toUpperCase();
    if (RANKS_UI.includes(val)) return val;
    alert('Not a valid rank, try again.');
  }
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
      targetedMeldId = targetedMeldId === meld.id ? null : meld.id;
      render();
    });
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'meld-cards';
    meld.slots.forEach((slot) => {
      const cardEl = buildCardEl(slot.card, { ownerId: slot.ownerId, wildAs: slot.wildAs, pickable: canRearrange });
      if (canRearrange) {
        cardEl.addEventListener('click', (ev) => {
          ev.stopPropagation(); // don't also toggle meld targeting
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

  $('turnLabel').textContent = game.gameOver
    ? 'Game over'
    : r.ended
    ? 'Round over'
    : r.part === 'turn0'
    ? 'Turn 0 — starter exchange'
    : `Player ${r.current + 1}'s turn — Part ${r.part}${r.current === 0 ? (comeOut ? '' : ' (not come out yet)') : ''}`;

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

  $('drawPileBtn').disabled = !(isHumanTurn && r.part === 1);
  $('undoDrawBtn').disabled = !(isHumanTurn && CascadeEngine.canUndoDraw(game));
  $('layMeldBtn').disabled = !(isHumanTurn && r.part === 2 && selected.length >= 3);
  $('addToMeldBtn').disabled = !(isHumanTurn && r.part === 2 && comeOut && selected.length === 1 && targetedMeldId);
  const targetedMeld = r.tableau.find((m) => m.id === targetedMeldId);
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

$('layMeldBtn').addEventListener('click', () => {
  const hand = game.round.hands[0];
  const ids = [...selectedHandCardIds];
  const selectedCards = ids.map((id) => hand.find((c) => c.id === id));
  const nonJoker = selectedCards.find((c) => c.rank !== 'JOKER');
  if (!nonJoker) return showError('Need at least one non-joker card in the meld.');
  const jokerCards = selectedCards.filter((c) => c.rank === 'JOKER');
  const wildAsMap = {};
  for (const j of jokerCards) {
    // Only rank matters — suit (if the meld turns out to be a run) is
    // always implied by the meld's real cards, never a separate choice.
    const rank = promptRank(`Joker stands in for which rank?`);
    if (!rank) return;
    wildAsMap[j.id] = { rank };
  }
  const selections = ids.map((id) => (wildAsMap[id] ? { cardId: id, wildAs: wildAsMap[id] } : { cardId: id }));
  try {
    CascadeEngine.layNewMeld(game, selections);
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
  let wildAs;
  if (card.rank === 'JOKER') {
    // Only rank matters — a run's suit is always implied by its real
    // cards, never something the caller needs to supply.
    const rank = promptRank(`Joker stands in for which rank in this ${meld.type}?`);
    if (!rank) return;
    wildAs = { rank };
  }
  try {
    CascadeEngine.addToMeld(game, targetedMeldId, cardId, wildAs);
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
  const allCardIds = meld.slots.map((s) => s.card.id);
  try {
    CascadeEngine.pullFromMeld(game, meld.id, allCardIds);
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
