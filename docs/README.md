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

## Running the tests

The engine (`engine.js`) and AI (`ai.js`) have a committed regression suite
in `../tests/` — plain Node scripts, no dependencies or build step. Run the
whole thing from the repo root:

```
node tests/run-all.js
```

This runs all `rules_check*.js` targeted unit tests (one file per feature
area — Turn 0, joker repositioning, rearrange sessions, ownership, etc.)
plus two headless AI-vs-AI simulations (`sim2.js`: 300 games, `sim_stress.js`:
1000 games) that check for turn stalls and card-conservation violations.
Exits non-zero if anything fails. Run it after any change to `engine.js` or
`ai.js` — this is the actual regression net referenced throughout the
playtest-round entries below, not just a description of testing that
happened once in a chat session.

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

**Fifth playtest round (2026-07-27)** — a real bug in the "Undo pickup"
escape hatch itself: `finishDrawing()` (the "Done drawing → Part 2" button)
was clearing `lastDraw`, which silently closed the undo window the moment a
player moved into Part 2 — even though nothing else had actually happened
yet. Someone who takes an unmeldable card, ignores the pre-take warning,
then clicks "Done drawing" before realizing they're stuck (exactly what
happened in testing) would find "Undo pickup" already disabled, with no way
back and no legal move forward. Fixed: the undo window now survives the
Part 1 → Part 2 transition, and only closes once an actual meld/add/swap/
pull action succeeds — undoing after `finishDrawing` reverts that
transition too, back to a clean Part 1.

**Sixth playtest round (2026-07-27)** — minor display bug: adding a card to
the *low* end of a run (e.g. adding 9♠ to an existing 10♠-J♠-Q♠) always
appended it to the end of the meld's internal card list, so the tableau
showed "10♠ J♠ Q♠ 9♠" instead of "9♠ 10♠ J♠ Q♠". Not a legality bug — the
meld was always valid and scored correctly either way — just a display-order
mismatch. `addToMeld` now inserts at the front when extending the low end of
a run, matching visual left-to-right sequence order.

**Seventh playtest round (2026-07-27)** — two related additions after a
"why didn't the AI swap the joker?" question:
- **The AI now considers joker swaps**, not just adding alongside them: if
  it can add a real card to a meld AND that meld has a joker it could
  instead swap out for the same rank/suit, it now prefers the swap (freeing
  up a 50-point wildcard to redeploy). This surfaced a real self-inflicted
  stall risk during testing — the AI could swap out a joker, then be unable
  to replay it (§2.3 requires the replaced joker be played back into a meld
  the same turn), stranding itself. Fixed the same way the row-pickup
  version of this problem was fixed earlier: `canReplayJokerAfterSwap()`
  verifies the joker will actually be replayable *before* committing to the
  swap (checking both that a valid meld exists for it and that laying it
  wouldn't itself use the player's entire remaining hand — a second,
  narrower version of this same "would this use the whole hand" gap also
  turned up in the plain row-pickup check, `canResolvePickup`, and is fixed
  there too). A defensive fallback was also added: if the AI's obligated-
  card resolution genuinely fails despite these checks, it now calls its
  own "Undo pickup" rather than stalling forever — verified via a 1000-game/
  8000+-round stress run (not just the standard 300-game suite) with zero
  stalls, since this failure mode was rare enough to need the larger sample
  to reliably catch.
- **New mechanic: adding a card to a run can reposition an existing joker**,
  not just extend an end (DESIGN.md §2.3/§3 decision 12) — e.g. a run of
  JOKER(as 9),10,J becomes 10,J,QUEEN(joker),K when a K is added, by
  reassigning what the joker stands for. `solveRun()` (the same span/gap-
  filling logic `autoResolveMeld` already used for laying brand-new melds)
  is now shared for this case too. Ownership of pre-existing cards is
  unaffected by the reposition — only the newly added card gets newly
  credited.

**Eighth playtest round (2026-07-27)** — three more from live play:
- **Real bug: score display double-counted meld points after a round
  ended.** `liveScore()` = persisted total + this round's meld points so
  far — but once a round ends, `scoreRound()` already folds that round's
  meld points into the persisted total, and the tableau isn't cleared
  until "Next Round" actually starts fresh. So the running-total addition
  was counting the same points a second time, e.g. a round scored "P1 130,
  P2 100" displayed as "P1 290, P2 150" at the top. Fixed: `liveScore()`
  just returns the persisted total directly once `round.ended`.
- **AI heuristic was much weaker than it looked**: `pickDraw` only ever
  evaluated `openRow[0]` — the single oldest card — so a great pickup
  sitting a few cards deep in the row (reported case: a same-suit run
  buried under unrelated cards) was never even considered, no matter how
  useful, and anything requiring a scoop bigger than 2 cards was ruled out
  before checking value at all. Rewrote to scan every position in the row,
  keeping only resolvable candidates (still gated by `canResolvePickup`, so
  it can't strand itself) and preferring cheaper/more valuable scoops over
  bigger, clutter-dumping ones. This also exposed a second bug in the old
  code's cheap pre-filter (checking only the hand, before the real
  resolvability check) — it wrongly rejected scoops that were already
  self-sufficient (e.g. 3♦-4♦-5♦ needs nothing from hand at all) — removed
  in favor of relying on `canResolvePickup` alone.
- **Suit symbols were hard to read**, especially spades vs. clubs (both
  black, no color to help, and small at the original size) in a long open
  row. Rank and suit are now separate, independently-styled elements (the
  suit symbol noticeably larger, stacked below the rank) instead of one
  plain text string.

**Ninth playtest round (2026-07-27)** — a UX fix and a substantial new
feature:
- **Clearer error when a joker-swap doesn't match.** A run of JOKER(as 9),
  10,J plus a matching-suit Q correctly lets you *add* the Q (it directly
  extends the run) but correctly *rejects* swapping the Q in for the joker
  (it's not the 9 the joker represents — swap only ever trades a joker for
  the exact card it stands for). That distinction was real but the error
  message for the rejected swap didn't explain it. Both `swapJoker`'s error
  and the "click the joker directly" UI path now name the exact rank (and
  suit, for runs) the joker represents, and point at "Add selected card to
  targeted meld" as the right button if the goal was just extending the run.
- **New: full tableau rearrange session** (DESIGN.md §2.3/§3 decision 13),
  a draft-then-commit mode alongside the existing single-card pull. Click
  "Rearrange tableau…" to start: every card on the table (either player's)
  plus your own hand becomes freely regroupable — click a card, then click
  a group to move it there, "Move selected to a new group", or "Move
  selected to hand". Groups show live valid/invalid feedback (green/red
  border) as you go, using the same `resolveGroup()` solver that powers
  auto-resolved melds and joker repositioning. Nothing is written back to
  the real game state until "Commit rearrange" — if any group is still
  invalid, or a non-owned pre-existing card got left in hand, it lists the
  specific problems and lets you keep adjusting; "Cancel rearrange" reverts
  to the exact pre-session state. Two invariants keep the wider mid-session
  access (any card, not just your own) from reopening the exploit the
  single-pull's ownership restriction was built to close: a pre-existing
  card always keeps its *original* owner no matter which group it ends up
  in, and a pre-existing card that isn't yours can't simply be left in
  hand — it has to end up in some valid group.

**Tenth playtest round (2026-07-27)** — two fixes about who acts when,
both after a live-play report that one player was always going first:
- **Round starter is now chance-based, then alternates** (DESIGN.md
  §2.2/§3 decision 14). Round 1 of a new game picks its starter at random;
  every round after that alternates from the previous round's starter,
  regardless of who won it. Previously `newGame`/`startRound` had no
  starter logic at all and implicitly always began with player 1 — an
  unconfirmed assumption, not a deliberate design choice.
- **Taking the Turn 0 starter card and swapping now correctly ends that
  player's go** (DESIGN.md §2.6/§3 decision 15). Previously, after Turn 0
  resolved, Turn 1 always went back to whoever started the round —
  including when that same player had just taken the starter card and
  swapped in Turn 0, which meant they could effectively "double turn" for
  free. Now Turn 1 goes to the **opponent of whoever made the last
  accepted swap** in Turn 0; only if nobody accepted anything does the
  original starter still begin Turn 1. Verified via 3 new targeted unit
  tests covering all 4 Turn-0 resolution paths, plus a real-browser CDP
  click test confirming: (a) `newGame()` produces both starters across
  repeated trials, not just one, and (b) taking the Turn 0 card and
  swapping via an actual UI click hands the very next turn to the AI, not
  back to the human.

**Eleventh playtest round (2026-07-27)** — two testing/visibility requests,
plus a real bug caught along the way:
- **Four-color deck.** Suits now use four distinct colors instead of the
  standard red/black — spades black, clubs green, hearts red, diamonds
  blue — so spades vs. clubs (previously both plain black) are easy to
  tell apart at a glance. `suitClass()` in app.js and the `.card.suit-*`
  rules in style.css.
- **AI hand debug view.** A new panel above the table always shows the
  AI's actual 7 cards face-up (`renderAiHand()`, `#aiHand`), clearly
  marked as a testing aid — the real game would never reveal an
  opponent's hand. Dashed border to visually set it apart from the real
  interactive UI.
- **Real bug found while screenshotting the above**: the tableau
  rearrange session's control buttons (Move to new group / Move to hand /
  Commit / Cancel) were visible and clickable *even when no rearrange
  session was active* — the exact same bug class as the `#modalRoot`
  incident from playtest round one. Root cause: `.controls { display:
  flex }` beats the browser's default `[hidden] { display: none }`
  regardless of specificity (author styles always win over the user-agent
  stylesheet), and `#rearrangeControls` (which has class `controls`) never
  got a matching `.controls[hidden]` override the way `.banner[hidden]`
  and `.modal-root[hidden]` already had. Fixed by adding
  `.controls[hidden] { display: none; }`. Worth remembering for any future
  element: giving a class `display: flex/grid/etc.` silently breaks
  `hidden` on every element with that class unless a `[hidden]` override
  is added alongside it.

**Twelfth playtest round (2026-07-27)** — three fixes from an independent
brutalcritic adversarial review (not live play), all confirmed by directly
reading and testing the actual code rather than trusting this file's own
"resolved" claims:
- **Real bug, highest severity found so far: a genuine soft-lock.**
  `swapJoker` had no hand-length guard, unlike its sibling actions. If a
  player swapped a joker out while holding only the replacement card, the
  joker returned to hand as a new "must meld this turn" obligation, but by
  then it was the *only* card left — and melding your last card is illegal
  outright (§3 decision 8), while discarding is blocked while any
  obligation is outstanding. Every button ended up disabled at once, with
  no persistence, so it was a full game loss with no recovery but a reload.
  A second, more general path to the same trap existed too: any Part 2
  action (`addToMeld`, `layNewMeld`) that shrank the hand while an
  *unrelated* obligation sat untouched could strand that obligation the
  same way. Fixed with one shared invariant, `assertLeavesHandUsable()`,
  checked before mutating state in `swapJoker`, `addToMeld`, and
  `layNewMeld`: none of them may leave the hand at or below the number of
  cards still owed to an outstanding obligation. This is now DESIGN.md §3
  decision 16. Verified with 5 new targeted tests in `rules_check13.js`
  (2 reproduction cases + 2 "legal use still works" controls + 1 for the
  `layNewMeld` path), plus the full simulation suite re-run clean.
- **The Node test suite is now actually part of the repo.** All 13
  `rules_check*.js` files and the two simulations (`sim2.js`,
  `sim_stress.js`) previously only existed as scratch files in a temp
  directory outside git — the review correctly pointed out that the only
  evidence for the correctness of the newest, most-revised features (Turn
  0, repeated row-takes, tableau pull, the rearrange session) was
  unreviewable and one `rm -rf` away from not existing. They're now
  committed under `../tests/`, with a `tests/run-all.js` runner (`node
  tests/run-all.js`) that executes all of them and exits non-zero on any
  failure. The one-off CDP browser-click debug scripts used throughout
  this project's history were deliberately *not* committed — most are
  disposable single-use probes (`cdp_debug1.js`, `cdp_unstick.js`, several
  numbered retries of the same check) rather than a maintained suite;
  real-browser verification remains a manual step for now.
- **The `[hidden]`/`display:flex` bug class is now fixed structurally**,
  not just patched at the two sites it was caught (`#modalRoot`,
  `#rearrangeControls`). A single `[hidden] { display: none !important; }`
  rule near the top of `style.css` guarantees `hidden` actually hides
  *any* element, current or future, regardless of what other rules give it
  a `display` value — replacing the two now-redundant per-selector
  overrides (`.banner[hidden]`, `.modal-root[hidden]`, `.controls[hidden]`,
  all removed). This closes the bug class for good instead of relying on
  remembering to add a matching override every time a new dynamically
  shown/hidden element is introduced — the mechanism that let it recur
  once already.

**Thirteenth playtest round (2026-07-27)** — visibility fix: rank/suit
were centered on every card, which worked fine for an isolated card but
meant a buried card in the open row (each card overlaps the next one's
left ~30px, per `.open-row .card { margin-left: -30px; }`) had its
identifying text hidden under the card on top of it — you couldn't tell
what was actually stacked in the row without scooping it. Moved rank/suit
to the top-left corner (`justify-content`/`align-items: flex-start` +
padding on `.card`, matching a real card's corner index) instead of
centered, since the open row's overlap always covers a card's *right*
side, never its left — so the identifying text now stays in the strip
that's always visible, on every card in the row, not just the top one.
Applies everywhere (hands, tableau, open row) for visual consistency, not
just the row. Confirmed via a real-browser screenshot with a 9-card
overlapping open row — every card's rank/suit legible.

**Fourteenth playtest round (2026-07-27)** — a real rule correction, plus
two bugs it exposed while fixing it:
- **The open-row pickup's bottom card can be discarded back, not just
  melded** (DESIGN.md §2.5/§3 decision 17, confirmed against the
  designer). Previously the engine and UI both hard-required melding it,
  which was never actually confirmed and turned out to be wrong. Now
  `discard()` allows discarding that specific card straight back to the
  row as an alternative resolution — a normal Part 3 discard, not a
  separate mechanic. A joker reclaimed via swap-out is unaffected and
  still requires a meld; only the row-take's card is discard-eligible.
  New `rowObligationCardId` tracks which (if any) outstanding obligation
  qualifies. The obligation label and Discard button in the UI were
  updated to match — the button now enables once the row card specifically
  is selected, even with the obligation still technically outstanding.
- **Real AI bug found by the user via a live screenshot**: taking a card
  from the open row triggered "no legal meld possible" even though the
  user's own follow-up actions proved Q,JOKER(as K),A-hearts was a
  perfectly valid run. Root cause: the AI's `findCandidateRuns` only ever
  detected a joker extending an *already-adjacent* pair by exactly one
  rank — never a joker filling an internal gap between two non-adjacent
  real cards (Q _ A needing a K), and never extending downward either.
  Rewritten to try every same-suit anchor-card pair and hand the actual
  gap-filling math to the engine's own `solveRun()` (now exported) instead
  of a narrower hand-rolled search — this is the same solver `addToMeld`'s
  joker-reposition fallback already relies on, just reused rather than
  re-derived.
- **A second, more severe bug this fix immediately exposed via
  simulation**: `tryLayMeldContaining` (used both for the AI's own play
  and indirectly for the human pre-take warning) only ever tried the
  *first* candidate meld containing a given card and gave up entirely if
  it failed — previously harmless, since the old candidate search only
  ever produced one candidate per card. The rewritten search can now
  legitimately produce several overlapping candidates for the same card
  (e.g. one that would consume the player's *entire* hand — invalid — and
  a smaller valid alternative using the same cards), and picking the
  invalid one first caused a genuine infinite loop: the AI would take the
  same row card, fail to place it, undo, and retake it forever. Caught by
  the 1000-game stress simulation, not manual play. Fixed by trying every
  candidate in order until one actually succeeds, in both
  `tryLayMeldContaining` and the general already-come-out melding loop in
  `playPart2`. Also updated `pickDiscard` to prioritize an outstanding row
  obligation (since `discard()` now rejects any other card while it's
  unresolved) and made the AI prefer discarding an unmeldable row card
  back over a full pickup undo, which needlessly sacrifices the rest of
  the scoop.
- Verified with 6 new engine-level tests (`rules_check14.js`) covering the
  discard-back rule itself, 4 new AI tests (`rules_check7.js`) for the
  run-detection fix and the new discard-back fallback, 3000+ deterministic
  simulated games across 3 separate seed ranges with zero stalls (the
  original bug needed ~1000 games to surface even once), and real-browser
  CDP verification of the full human-facing flow: taking an unmeldable row
  card, seeing the updated obligation label, and discarding it back via an
  actual UI click.

**Fifteenth playtest round (2026-07-27)** — direct follow-up question from
the user after the discard-back fix above: they'd picked up a row card that
couldn't be melded onto anything on the table, and wanted to fold it into a
new grouping via a tableau rearrange session instead — but "Rearrange
tableau…" was greyed out. Confirmed against the designer: an outstanding
**row-take** obligation should no longer block starting a session (a
meld-only joker-swap obligation still does — that wasn't part of what was
confirmed). Implemented so the obligated card participates in the session
like any other card: fold it into a valid group and the obligation clears
at commit exactly like a normal meld would; leave it in the hand pool and
the obligation simply survives the session, still resolvable afterward via
a meld or discard-back. The tableau hint text during an active session now
also names the still-owed card when one is outstanding, so it's clear it
still needs to land somewhere valid. This is DESIGN.md §2.3/§3 decision 18,
a direct follow-up to decision 17. Verified with 3 new engine tests
(`rules_check14.js`) — session allowed with a row obligation but blocked
with a meld-only one, obligation cleared when folded into a valid group,
obligation preserved (and still dischargeable afterward) when left
untouched — plus a full real-browser run: took an unmeldable row card via
a real click, confirmed the Rearrange button was enabled and the hint
text was correct, built the resolving group, and committed via a real
button click, ending with the obligation cleared and the card sitting in
a new run on the table.

## Known simplifications (mock, not final spec)

- **Joker wildcard rank entry uses `prompt()` dialogs**, not a proper picker
  UI — fine for testing legality/flow, not representative of final UX.
- **AI is a greedy heuristic** (first candidate meld found, cheapest-looking
  row pickups only, never uses tableau rearrangement) — not the phase-2 AI,
  and not tuned for a good game feel. It does consider joker swaps when
  adding a matching real card, and verifies both row pickups and joker
  swaps are actually resolvable before committing to them, so it won't
  strand itself the way a real player wouldn't.
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
