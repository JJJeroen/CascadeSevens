# Cascade Sevens — Web Rules Mock

A static, no-build-step web page implementing the Cascade Sevens ruleset (see
`../DESIGN.md`) so the rules and the cascade-pickup interaction can be played
and felt before any React Native work starts. This corresponds to roadmap
phase 0 in DESIGN.md §7 (UI feasibility spike), extended to cover the full
ruleset rather than just the cascade interaction.

Hotseat: you play Player 1. Player 2 is a simple heuristic bot (not the
"real" AI scoped for phase 2 in DESIGN.md §5.2) — enough to test against
without needing a second person.

## Running locally

No build step. From this directory:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## What's implemented

Full ruleset from DESIGN.md as of the 2026-07-26 revision: deck/deal, the
asymmetric Turn 0 starter-card exchange (§2.6), draw from closed pile or
open-row cascade pickup (§2.5 — available every turn, not gated on come-out),
the 40-point/four-of-a-kind come-out gate for laying new melds (§2.4), new
melds (sets and runs, Ace anchoring either end with no wraparound), adding to
any meld on the shared tableau, **full tableau rearrangement** — pull one or
more cards back out of any meld and re-lay them elsewhere (§2.3/§3 decision
2; click a card inside a meld to pull just that one, or target a meld and use
"Pull entire targeted meld" to fully dissolve it), joker wildcards placed
directly into melds, joker swap-out with the same-turn replay obligation,
per-card ownership scoring that transfers to whoever last placed a card,
a live running score display (§2.8 app-behavior note), the illegal-to-empty-
your-hand guardrail replacing the old mid-turn-win rule (§2.7/§3 decision 8),
closed-pile empty ending the round immediately (§3 decision 3), and the
two-part (>1000-or->300 and strictly ahead) game-end condition (§2.9).

Verified with a headless simulation (both seats played by the bot) across
2,500+ rounds with no stalls and full 54-card conservation every round, plus
12 targeted rule checks (come-out gate, Ace anchoring/no-wraparound, the
asymmetric Turn 0 paths, the can't-empty-your-hand guard on both meld actions,
tableau-pull edge/middle/dissolve legality, come-out gating on rearrangement,
and ownership transfer on re-lay) — see git history for the check scripts.
Real-click verification (not just programmatic `.click()` — see the
2026-07-23 postmortem below) confirmed the pull-single-card and
pull-entire-meld interactions and the live score display all work through
actual mouse hit-testing, not just direct engine calls.

**Getting stuck after an open-row pickup (2026-07-26 fix)**: taking from the
row is voluntary, but nothing stopped a player from taking a card they
couldn't actually meld and then having no legal move at all. Fixed two ways:
clicking a row card now warns first if no legal meld for the obligated
(bottom) card seems possible given your current hand, and if you take it
anyway (or the check misses something) an "Undo pickup" button reverts the
draw completely — available until you do anything else that turn.

**Joker "duplicate card" display bug (2026-07-26 fix)**: a joker used in a
set was being tagged with the same suit as the real card next to it (e.g.
"J→A♠" sitting beside a real A♠), making it look like a physically
impossible duplicate. It wasn't actually a duplicate — just a bad label. For
sets, suit is meaningless; for runs, a joker's suit is always implied by the
run's real cards, never something that needs to be separately tracked or
displayed. Jokers now only ever carry a rank.

**Second playtest round, same day (2026-07-26)** — four more fixes from
actual play:
- **Open-row takes now repeat within Part 1** (DESIGN.md §2.3/§3 decision 9):
  taking from the row no longer ends Part 1 by itself. It can be repeated any
  number of times, but locks out the closed pile for the rest of that turn
  once used, and only the most recent take's bottom card is the binding "must
  meld" obligation — an earlier one is superseded, not stacked. A new "Done
  drawing → Part 2" button ends Part 1 explicitly.
- **No more joker prompts when laying a new meld**: `autoResolveMeld()` works
  out on its own whether any valid set or run exists for the selected cards
  — including every way a joker could fill a gap or extend a run — instead
  of making the player pre-guess a specific rank. Same for adding a joker to
  an existing meld (`autoResolveAddToMeld()`), which tries both legal run
  extensions automatically.
- **Joker click now swaps when it should, instead of always pulling**:
  clicking a joker sitting in a meld used to always attempt a rearrangement
  pull, which correctly (but confusingly) fails for a joker filling a run's
  internal gap, since removing it alone breaks the run. If a matching hand
  card is already selected, clicking the joker now performs the atomic
  swap-in-place action instead.
- **Selection state made visible**: a "Selected: …" indicator plus a "Clear
  selection" button, after a report of an action button staying disabled
  when it looked like it should be enabled — the likely cause was a stale
  multi-card selection left over from an earlier attempt, silently still
  counted.

**Third playtest round, same day (2026-07-26)** — the live-score display
(added in round one) surfaced a rule bug that pure engine testing never
would have: a player's 30-point come-out attempt was visibly sitting on the
tableau, but the app still said "not come out yet" with no way to explain
why. Root cause: `comeOutAccum` was a single value reset to 0 at the start
of every turn, so a below-40 attempt effectively evaporated the moment the
turn ended. Confirmed against the game's designer: **come-out progress
carries forward across turns** — a 30-point attempt today plus a 15-point
meld three turns later still crosses 40 and comes out. Fixed by making
`comeOutAccum` a per-player array that's only ever incremented, never reset
mid-round (§2.4/§3 decision 10). The turn label now also shows live
progress toward 40 when it's non-zero, so this shouldn't be confusing again.

**Known interaction risk, not a bug (found via testing, 2026-07-26)**: open-
row cards visually overlap by design (the cascade effect), so a later card
can sit on top of most of an earlier one. Clicking near the exact geometric
center of a heavily-covered card can land on its neighbor instead of the
card itself. This is the exact risk DESIGN.md §7 phase 0 flagged before any
code was written ("tapping a specific buried card... is a real interaction-
design risk") — worth a dedicated look before the native UI, not something
fixed here.

**Fourth playtest round (2026-07-27)** — two more fixes from live play:
- **Real bug: pulling was letting a player take back cards the opponent had
  laid.** Confirmed against the designer: rearrangement is restricted to
  cards the pulling player currently owns — either player can still *add*
  to any meld, but only *pull back* their own. `pullFromMeld` now rejects
  with a specific message naming the card and explaining why. The "Pull
  entire targeted meld" button was renamed "Pull my cards from targeted
  meld" and now only ever attempts the player's own subset of a meld — on a
  mixed-ownership meld, that can still legitimately fail if it would leave
  the opponent's remaining cards below 3 (a correct, if slightly
  frustrating, interaction between two independently-correct rules, not a
  new bug).
- **Targeting made sticky and visible**, after a second report of "the
  button is disabled and I don't know why": clicking a meld's border used
  to *toggle* targeting on a re-click, silently un-targeting it with no
  feedback — a plausible cause of exactly that confusion. Meld clicks are no
  longer a toggle (always (re-)targets); a new "Targeted meld: …" indicator
  sits next to "Selected: …"; and "Clear selection" (now "Clear selection &
  target") resets both at once instead of leaving stale state behind.

## Known simplifications (mock, not final spec)

- **Joker wildcard rank entry uses `prompt()` dialogs**, not a proper picker
  UI — fine for testing legality/flow, not representative of final UX.
- **AI is a greedy heuristic** (first candidate meld found, cheapest-looking
  row pickups only, never uses tableau rearrangement or joker swaps) — not
  the phase-2 AI, and not tuned for a good game feel. It does verify a row
  pickup is actually resolvable before taking it, so it won't strand itself
  the way a real player wouldn't.
- **No persistence** — refreshing the page loses game state.

## Postmortem: a real bug that shipped past automated testing (2026-07-23)

An invisible full-page overlay (`#modalRoot`, meant for future modal dialogs
but never actually used — joker input uses `prompt()` instead) silently
blocked every click on the live site for a while. Its CSS set an
unconditional `display: flex`, which beat the browser's default
`[hidden] { display: none }` at equal specificity, so the `hidden` attribute
did nothing. `button.click()`-based smoke tests didn't catch it because that
skips the browser's hit-testing entirely. Fixed with an explicit
`.modal-root[hidden] { display: none; }` override, and confirmed by comparing
`document.elementFromPoint()` before/after and dispatching real
`Input.dispatchMouseEvent` clicks via CDP. Lesson: verify real click flows
with actual pointer events, not `.click()`, before calling a UI "tested."
