# Online multiplayer for Cascade Break: design draft (2026-11-09)

Status: **draft for the owner**, nothing built. It reuses the mechanism Mountain Mayhem built
(`mountain-mayhem/docs/plans/2026-11-08-online-multiplayer.md` and `server/`, steps 1-5; its PRs #65/#66
are still waiting for a phone test and deploy, so treat that code as "built and tested, not yet proven live").
DESIGN.md section 5.3 already reserves this ("clients send intents, the server runs the same engine");
this document replaces the unbuilt parts of that section.

Confidence tags: **[read]** = checked in the code today, **[recalled]** = from earlier reviews, not re-read, **[guess]** = my inference.

## 1. Goals and non-goals

- Two remote people play a full game (rounds to the goal) against each other, each on their own phone. **[owner's ask]**
- Wordfeud-style: either both online and playing nearly live, or taking turns over hours/days, with a turn clock.
- Hidden cards stay hidden: the opponent's hand and the closed pile never reach the other client.
- No accounts: a name, an avatar, and a secret kept on the device, as in Mountain Mayhem.
- **Not now:** matchmaking with strangers, spectators, more than 2 players, playing the AI online (the AI stays on the device, as now), chat.

## 2. Why a referee server

The engine (`src/engine.ts`) holds the whole game in one `Game` object, with no DOM and randomness only through an injected `rng` **[read]**, so it can run on a server unchanged (it compiles to `docs/engine.js`). A server that runs it is the only way to keep hands hidden, to get a trustworthy turn clock, and to refuse illegal moves (the engine throws on them, which is what the rules tests rely on **[read]**).

## 3. Architecture (copied from Mountain Mayhem)

Cloudflare Worker + two Durable Objects, free plan (Mountain Mayhem's runs on it **[recalled]**):

- **Game DO**, one per game: the full `Game`, the two seats, a step log, one alarm armed for the next timed event.
- **Directory DO**, one: players (secret kept only as a SHA-256 hash), invite codes, who is in which game and whose turn it is.
- **Worker**: routes `/api/...`, checks the token, refuses too-old app versions (426).
- No WebSocket: the game screen polls every ~3 s while visible; push (later) covers the closed app.
- A **separate Worker** (`cascade-break`) and its own Firebase project for push; no shared state with Mountain Mayhem.

What to copy as-is, what is new:

| Part | Mountain Mayhem | Cascade |
|---|---|---|
| Worker, Directory, tokens, invite codes, IP rate limit | `server/src/worker.js` | copy |
| Lobby (create, join by code, kick, leave, cancel) | `room.js` | copy, 2 seats |
| Turn clock, alarm, `nextEvent`, 410 tombstones, delete-after-30-days | `room.js`, `worker.js` | copy |
| Fake server in the browser for tests, `net.js` | `web/fake-server.js`, `web/net.js` | copy, adapt |
| Action = one `apply(action)` with `legalActions` | `engine.js` | **new**: see section 5 |
| `viewFor` | `engine.js` | **new**: see section 4 |
| Bot takes over a forfeited seat | yes | **no** (2 players: the other player wins) |

## 4. Hidden information: `viewFor(game, seat)`

The server keeps the whole `Game`; a client only ever gets a view. Allowlist (anything not listed is dropped), so a field added later cannot leak:

- **Hidden from the opponent:** `closedPile` (send the count), the other player's `hands` entry (send the count), `owedThisTurn`/`pendingObligations`/`rowObligationCardId` (own turn only), `undoStack`, `turnStart`, `lastDraw`, `comeOutAttempt`, `rearrange`, and `rng`/seed. **[read: field list in `src/types.d.ts`; `turnStart`, `lastDraw` and `undoStack` hold full hands and rows]**
- **Public:** `openRow`, `tableau` (with card owners), `scores`, `comeOut`, `part`/`current`, `roundNumber`, `threshold`, the log lines that name no hidden card.
- **At round end** the loser's remaining hand is revealed (it is counted as penalty points, DESIGN 2.8), so the end-of-round view includes both hands.
- Turn 0 only uses the open row and the players' own hand cards, so it needs no extra hiding **[read]**.

## 5. How a turn travels: the main design choice

Cascade's turn is not one move. It is: take or draw, lay and add and pull back and rearrange as often as wanted, then discard. Undo, "Start turn over" and the rearrange draft all live in the client today.

**Option A, one server call per action.** The server mirrors every lay/add/pull/rearrange, plus undo and the draft. Simple to reason about, but the server must learn undo, restart and the draft, and each tap needs a round trip.

**Option B (recommended), the turn is played locally and sent as a bundle.**
1. The only hidden-information action is **drawing from the closed pile**. That is one server call (`/draw`) that returns the card; the client adds it to its local hand.
2. Everything else (cascade takes, laying, adding, pulling back, rearranging, Undo, Start turn over) runs **locally on the client's view** with the existing engine and UI, unchanged.
3. When the player discards, the client sends the **list of actions** it performed this turn. The server **replays them on its own `Game`** with the real engine. If every call succeeds and the turn ends legally, the server accepts and advances; if any throws, it answers 409 with the reason and the client resets to the server's view.

Why B: undo, the draft and "Start turn over" stay local (no new server logic), one call per turn instead of one per tap, and the server is still the referee because it re-checks everything with the real engine. The opponent sees the finished turn, which is fine for a game played over hours; for near-live play they also get it within ~3 s of the discard.

**Costs and risks of B [guess, must be verified in the spike, section 9]:**
- The client's local engine runs on a *view*, whose closed pile is placeholders. Only the draw touches the pile; the UI must never call the draw locally online.
- The action log must be exactly replayable: layNewMeld/addToMeld/pullFromMeld/swapJoker arguments incl. joker choices, and a rearrange as `startRearrange`, a list of `rearrangeMoveCard` and `commitRearrange`. Meld ids (`nextMeldSeq`) and group ids are deterministic if the order is the same. A test must replay the logs of thousands of simulated games and compare the final states.
- The opponent's cards are not shown while they move. Instead the other client shows a sentence built from a before/after comparison, reusing the AI move line from #99 ("Anna drew from the pile, laid 10♣ J♣ Q♣ K♣ and discarded Q♠.").

Turn 0 (accept or decline the starter card) is a separate small call per decision. Round start and the deal are done by the server, with a server-side `crypto` random (never `Math.random`, never a seed the client knows).

## 6. Steps and polling

The server keeps a **step log**: `{seq, seat, kind, publicSummary, view}` with `view = viewFor(game after the step, you)`. `POST /act {seq, bundle}` must carry the current `seq` or gets 409 (stale). `GET /games/:id?since=seq` returns the steps not yet seen, or the latest view if the log was capped. The client sets its local state from the newest view and shows the sentence for the steps in between.

## 7. Turn clock, forfeit, resign

- **Clock** per turn (the whole turn, not per action), set at game creation. Start with 24 h and 72 h; 1 h only once push exists, because a 1 h clock without a notification is unfair (Mountain Mayhem decided the same).
- The clock restarts when the turn changes. Drawing does not restart it.
- **Timeout** = forfeit: the other player wins the **game** (not only the round). **Resign** the same. No bot takeover in v1; that is only useful with 3+ players.
- A lobby nobody joins is deleted after 7 days; a finished game 30 days after it ended; a cancelled game leaves a 410 tombstone.
- **Game length:** a full game to 1000 is many rounds. At a 24 h clock that takes weeks. Offer the Quick goal (300) as the default online and show the expected length. See question 2.

## 8. Rules version and app version

- Cascade's rules changed several times this week (decisions 14, 29, 30). A running online game must not change rules under the players: store `rulesVersion` in the game, and refuse moves on a game whose version differs from the server's, marking it "made with older rules". Rule changes bump it, as in Mountain Mayhem.
- `MIN_APP_VERSION` works like there; the app version is `0.<last merged PR>` **[read, CONTRIBUTING]**, so it needs a mapping to a semver-ish number or a separate `API_VERSION` constant. Decide in step 1.

## 9. Steps

0. **Spike, no deploy:** (a) record the action log in the engine tests and replay the logs of 1000 simulated games on a fresh `Game`, comparing final states; (b) write `viewFor` and a test that no card of the other hand or the closed pile appears anywhere in a serialized view; (c) check the engine runs in workerd (the Mountain Mayhem server tests show the way). If (a) fails, fall back to option A.
1. **Engine:** `viewFor`, action recording and replay, `rulesVersion`, server-side deal. Pure and tested like the rest (rules tests + simulations), in `src/`.
2. **Client refactor:** the UI assumes you are player 1 and the AI is player 2 **[recalled, verify]**; make it seat-agnostic (`mySeat`), hide level/goal/debug in online games, replace `playAiTurn` by "waiting for the opponent".
3. **Fake server in the browser** (copied from Mountain Mayhem) so the whole online flow is tested in CI without Cloudflare.
4. **Real server:** Worker + DOs, copied and adapted, tests in workerd.
5. **Clock, forfeit, resign, cancel**, games list.
6. **Push** (Firebase, own project), reminder at 75%, 1 h clock.

Each step is its own PR, with an Opus review in a fresh context, as in the rest of this repo. Step 0 produces the answer to the only real technical doubt, so do it before anything else.

## 10. Cheating and resuming (added after the owner's questions)

**Cheating with a modified app.** The server is the referee, so a hacked client gains nothing the rules do not allow **[reasoned, not yet tested]**:
- Every turn bundle is replayed on the server's own `Game` with the real engine. Illegal moves, cards not in hand, or a turn that does not end legally are refused (409).
- Hidden cards never leave the server (section 4), so there is nothing to read out of the app's memory. The deal and pile order come from a server-side `crypto` random.
- The pile draw is one server call, **once per turn**, recorded by the server; a turn bundle cannot contain a different draw, and a draw cannot be taken back, so nobody can re-draw for a better card.
- Undo inside a turn stays a normal rule (local); only the final result of the turn is sent.
- Not preventable, as in any online card game: using an outside program to compute the best move.
- Tests for step 0/1: a serialized view never contains a hidden card, and tampered bundles (extra card, wrong order, second draw, wrong player, stale `seq`) are all refused.

**Resuming.** The game lives on the server (Game DO), so it can be reopened any time from the games list and the app gets the latest view. A turn that is half played when the app closes: the drawn card is on the server and comes back with the view; the actions made locally are saved by the app (localStorage, keyed by game and `seq`) and replayed on reopening. If that save is gone, the player starts the turn over from the drawn card. Mountain Mayhem's save/resume is the model.

## 11. Open questions for the owner

Answered 2026-11-09 (owner): **1. option B**; **2. mostly both online at the same time**, but a game must be resumable later (so: short polling and a short default clock matter most; push is step 6); **3. yes, wait for Mountain Mayhem's phone test and deploy** (steps 0 and 1 can start meanwhile); **4. understood** (privacy policy before Play).

Still open:
- Is Quick (300) the online default, given mostly-live play? (A full 1000 game is long even live.)
- Tommer/Jelle: do they want a say in the online lobby screens (the Figma has none)?

## 12. Independent review (Opus, 2026-11-09) and what changes

An independent review ran exploits against the compiled engine. Verdict: Option B stays, but section 10's claim
"the engine throws on illegal moves, so replaying is enough" is **not true** for forged input. Mountain Mayhem is safe
because a move must equal one of `legalActions`; Cascade has no such list. Findings that change the plan
(verified by running code unless marked):

**Must be solved before any online play (hard requirements for step 1):**
1. **Forged melds.** `layNewMeld` does not reject duplicate card ids; `splice(-1, 1)` then removes the last hand card.
   A bundle of seven copies of one id was accepted as a "set" and won round 1 on turn 1. This is also a bug in the
   offline engine (a hacked client, not normal play). Fix: schema check on every action (verb whitelist, real deck ids,
   no duplicates, no `__proto__`), make `layNewMeld` throw on a missing card, and after every replay validate every meld
   and check the 54 ids are distinct across pile, row, hands and table.
2. **Turn boundary.** The engine acts on `r.current`, so a bundle could continue into the opponent's turn, and the error
   text becomes an oracle for their hand (45 requests recovered 7 cards). Fix: per-action check that `r.current === seat`,
   stop at the first turn end, never accept `drawFromClosedPile`, `turn0*` or `startRound` inside a bundle, and answer
   409 with only the failing action's index and a generic reason.
3. **Engine version.** Rules changed three times this week and games last days, so "refuse on a different rulesVersion"
   would kill most running games; and with Option B the client's local engine decides ids and results, so any engine
   change can silently diverge (the app version moves on every PR, so `MIN_APP_VERSION` does not protect). Decision
   needed (see open questions): pin each game to an engine build kept in the Worker, or freeze the rules before launch.
   Either way: engine hash on every call and a final-state hash in each bundle.

**Design corrections:**
- `/draw` returns the **full post-draw view**; the client replaces its state and clears its action log (otherwise meld ids
  diverge after "Start turn over", because `restartTurn` does not reset `nextMeldSeq`). `/draw` is idempotent so a lost
  response can be retried.
- Undo: decide in step 0 whether bundles include undo (server sets `undoFor = seat`) or the client sends a net list.
- Views drop `round.log` entirely (take-back lines reveal ranks). Public summaries are built from public-zone changes only;
  raw bundles are never stored in steps.
- Turn 0: whose move it is comes from `turn0CurrentAskee`, not `r.current`; permission check, clock and forfeit target use it.
- Engine is not atomic (`rearrangeMoveCard`, take-back): throw away the in-memory game on any error, as MM's `#run` does.
  `commitRearrange` returns `{ok:false}` instead of throwing: treat as failure.
- Shuffle rng: a crypto-backed function, never the engine's 32-bit `seededRng`. Seat 0 must not always start: assign
  seats at random on the server.
- Round end: capture the end-of-round view before `startRound`; decide whether the next deal waits for both players. The
  client must not show its own round score (it runs on placeholder cards).
- Step 2 shortcut to evaluate: `viewFor` rotates seats so the client is always seat 0 (app.ts hard-codes seat 0).
- Clock: owner expects mostly-live play, so offer a short live clock that pauses (not forfeits) plus a long resume clock.
- Free-plan quota: verify tokens in the Worker with an HMAC instead of a Directory call, and poll slower during the
  opponent's turn. Raise MAX_BODY above 16 KiB if long rearranges need it.

**Step 0 spike gets bigger:** record engine calls from random human-style walks (undo, take-back, restart, rearrange:
reuse `tests/sim_rearrange.js`), not only AI games (the AI never uses those paths); a forged-bundle fuzzer; key-order-stable
state comparison; the decision on undo and on engine pinning.

**Status correction:** Mountain Mayhem's #65/#66 are merged (c700861, bb82ec4), but still not phone-tested by the owner.

Scripts that reproduce the exploits are in the review's scratchpad (`forge2.mjs`, `oracle.mjs`, `diverge.mjs`, `forge.mjs`).

New open question for the owner: **engine pinning or rules freeze?** (item 3 above). Recommendation: freeze the rules
for online launch, plus the engine-hash check, and add pinning later only if rules must change while games are running.
