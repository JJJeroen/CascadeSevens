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

## 10. Open questions for the owner

1. **Option B (play locally, send the turn) vs. A (every action to the server)?** Recommended B; step 0 verifies it.
2. **Live or slow?** Are both players usually online together (then a short clock and 3 s polling matter most) or taking turns over days (then push matters most)? And is Quick (300) the online default?
3. **Wait for Mountain Mayhem's #65/#66 to be tested on phones and deployed first**, so Cascade copies something proven? (Recommended; step 0-1 can start meanwhile, they do not need the server.)
4. **Google Play:** an online game with a server and user-chosen names needs a privacy policy and Data Safety answers. Needed before the Play release, not before a friends-only APK.
5. **Tommer/Jelle:** do they want a say in the online lobby screens (Figma has none)?
