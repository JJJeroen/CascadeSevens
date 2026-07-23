# Cascade Sevens — Design Document

Status: **Design in progress, pre-build.** Working title / codename during dev was *Zevenen*. Original rules were dictated in Dutch and are translated + disambiguated below; several points weren't fully specified in the source rules and are decided or flagged open per §3/§9. No code written yet — this document is the spec to build the rules engine against.

**Revision note (2026-07-23):** an adversarial design review (brutalcritic) found a genuine self-contradiction in the original draft of the opening-turn exception (§2.5) and two unaddressed rule-interaction exploits between the come-out gate (§2.4) and the shared tableau (§3) — a player could otherwise rack up meld points or even satisfy come-out without ever meeting the 40-point bar, hollowing out the mechanic that's the game's whole identity (§4). All three are now resolved below; see §3 for the added decisions. The naming call (§6) was also downgraded from "chosen" to "working title" pending fuller diligence.

## 1. Concept

A 2-player card game in the Rummy/Gin-Rummy family, played with a standard 52-card deck plus 2 jokers (54 cards). Its distinguishing mechanic — not present in standard Rummy or Gin Rummy — is the **open row**: a single, growing, face-up sequence of discarded cards, each overlapping the last (like a solitaire cascade). A player may draw from the closed deck, *or* reach into the open row and take any card in it — but doing so forces them to also take every card discarded after it (everything visually stacked on top). That taken card must then be used in a meld that same turn. This turns discarding into a genuine tactical decision: bury a card the opponent wants deep enough, and taking it costs them a pile.

**Why this app:** the physical game (a Dutch family variant, working name "Zevenen"/"Duizend leggen"-adjacent) has no digital implementation. Building it digitally also removes the game's biggest real-world friction — manually counting hand/meld points every round — which a screen does instantly and without dispute.

Solo (vs. AI) first, matching the Appiness playbook: GitHub-hosted APK for sideload testing, then Expo EAS build to Google Play once stable. Multiplayer is a deliberate later phase — see §5.

## 2. Rules

### 2.1 Deck & card values

- One standard 52-card deck + 2 jokers = 54 cards.
- Values (used for meld scoring and hand-penalty scoring, *not* for meld-forming rank):
  - 2–9: **5 points**
  - 10–K: **10 points**
  - Ace: **25 points**
  - Joker: **50 points**

### 2.2 Setup (per round)

1. Shuffle all 54 cards.
2. Deal 7 cards to each player.
3. Flip the top card of the remaining deck face-up — this is the first card of the **open row**. The rest is the **closed pile** (draw pile).

### 2.3 Turn structure

Each turn has three parts, always in this order:

**Part 1 — Draw (mandatory, pick one):**
- Draw the top card of the closed pile into hand, **or**
- Take a card from the open row into hand — **only available once the player has come out (§2.4).** A player who hasn't come out yet may only draw from the closed pile; the open row is off-limits to them entirely (see §3, decided — this removes the deadlock between the pickup obligation and the come-out gate). Once a player has come out, taking a card from the open row also takes **every card discarded after it** (i.e. everything lying partially on top of it) — see §2.5 for the exact mechanic and the Turn 0 starter-card exchange.

**Part 2 — Meld actions (optional, any order, any number of times) — all of the below require the player to have already come out (§2.4); a player who hasn't come out yet cannot do any of them:**
- Lay down a new meld from hand. A meld is either:
  - **A set**: 3+ cards of the same rank, or
  - **A run**: 3+ cards in sequence, same suit. Ace can anchor either end of a run (A-2-3 or Q-K-A), but never both at once — no wraparound (K-A-2 is not a legal run). (§9, resolved)
- Add one or more cards from hand to an existing meld on the table — **any player's meld, laid by either player** (shared tableau, not a private one — see §3). Adding to a meld, own or opponent's, requires the adding player to have already come out; it cannot itself substitute for coming out (see §3, decided).
- Replace a joker sitting in a meld on the table with the real card it stands in for, taking the joker into hand. The replaced-out joker **must itself be played back onto the table in a meld that same turn** — it cannot just sit in hand afterward. No limit on how often the same joker can be swapped and replayed across a round — this is a deliberate skill/tempo battle, not a bug (see §3, decided).
- **Jokers are wild from the start**: a joker can be placed directly into a new or existing meld as a stand-in for any missing rank/suit card, not only via the swap-out action above (see §3, decided).

**Part 3 — Discard (mandatory, unless the round already ended in Part 2):**
- Play one card from hand face-up, placed partially overlapping the current last card of the open row, extending the row. All cards in the row must remain at least partially visible at all times.
- **Exception**: if Part 2 melded away the player's entire hand (0 cards remaining), the round ends immediately and Part 3 is skipped for that turn — see §2.7. (§9, resolved)

### 2.4 "Coming out" (first meld of the round)

The **first time** a player plays in Part 2 during a round, they must lay one or more brand-new melds **built entirely from cards in their own hand** (not by adding to any existing meld — see below) that together meet one of:
- Total value ≥ **40 points**, or
- Be **four cards of the same rank** (a full set of four, regardless of point value — e.g. four 2s = only 20 points but still satisfies this route).

Until a player has met this bar, in that same turn, from their own hand, they **cannot do anything in Part 2 at all** — no laying a new meld below the bar, no adding cards to any existing meld (own or opponent's), no joker swap. This closes an exploit an adversarial review found in the original draft: without this restriction, a player could add single cards to the *opponent's* already-open melds every turn, scoring full point value per card, indefinitely, without ever meeting the 40-point bar themselves — or even satisfy their own come-out cheaply by dropping one card onto an opponent's existing triple. Neither is allowed (see §3, decided).

### 2.5 The open row & the pickup rule

The open row is an **ordered sequence** of face-up cards, each overlapping the previous one, growing by one card every turn (Part 3). Because each new card is laid on top of the previous one:

- A player may pick **any card in the row** (once they've come out — §2.4/§2.3), but must take that card **and every card discarded after it** — i.e. a contiguous run from the chosen card to the current end of the row. You cannot cherry-pick a single buried card without also taking everything stacked above it.
- Whatever card the player chose as the *bottom* of that scooped-up group (the oldest card in the group — the one they actually reached for) **must be used in Part 2 of that same turn**, in a meld. The other, newer cards taken along with it can be used or simply added to hand with no obligation.

### 2.6 Turn 0 — the starter-card exchange

**Rewritten during the 2026-07-23 review** to fix a self-contradiction in the original draft (the original text promised the second player could take "that same single card" after a full turn had already buried it under a mandatory discard, which is impossible under the cascade rule above). This is now modeled as a standalone exchange that happens **once, before normal turn rotation begins** — it is not part of anyone's Part 1/2/3 turn, and it does not consume either player's Turn 1:

1. The first player (P1) may take the lone starter card into hand, exempt from the "must use it in a meld" obligation (§2.5) and from the come-out gate (§2.4) — this exchange never touches Part 2 at all. If P1 takes it, P1 immediately places one card from hand back onto the row (a straight one-for-one swap, no meld phase), and step 3 below applies.
2. If P1 declines, P2 may instead take that same lone starter card under the identical exemption, then immediately places one card from hand back onto the row. Step 3 below applies.
3. Whichever player did **not** take the card in step 1 or 2 may now take the newly-placed single card, once, under the same exemption, and must also immediately place one card from hand back onto the row.
4. If both players decline in steps 1–2, Turn 0 does not trigger at all — the original starter card simply stands as the row, and normal Turn 1 (P1) begins with all rules, including the come-out gate and pickup obligation, applying in full.

Because every acceptance in this exchange is a strict one-for-one swap, the row always contains exactly one card at the end of Turn 0, regardless of path — this is what makes the sequence internally consistent (the original draft broke this invariant). Normal turn rotation (P1, P2, P1, P2, …) begins immediately after Turn 0 resolves, unaffected by how many exchanges happened within it.

### 2.7 End of round

A round ends the instant a player reaches **0 cards in hand** — which happens at one of two points, resolved per §9:
- **Most commonly**, at the end of Part 3: the player's last card is played as that turn's mandatory discard.
- **Or, immediately during Part 2**, if a meld action melds away the player's entire remaining hand — the round ends right there, and Part 3 is skipped entirely for that turn (see the Part 3 exception above).

Either way, that player is the round's winner.

### 2.8 Scoring (per round)

- **Winner bonus**: +50 points to the round winner.
- **Meld points**: every card in every meld on the table scores for whichever player actually placed *that specific card* there — this requires per-card ownership tracking, not per-meld, since melds are shared and either player can add to any meld (§3). A player's meld score for the round = sum of the point values (§2.1) of every card they personally laid down or added, across all melds, all turns.
- **Hand penalty**: at round end, the *loser's* remaining hand cards are each worth their point value (§2.1) as **negative** points. The winner has 0 cards, so no penalty applies to them.
- Round score = winner bonus (if applicable) + own meld points − own hand penalty.

### 2.9 End of game

The game ends at the end of whichever round is the first in which one player has **more than 1000 total points** *and* has strictly more points than the other player. That player wins the game.

**No separate tie-break rule is needed (§9, resolved)**: this two-part condition is simply re-checked after every round. If it isn't met by exactly one player — both are over 1000 but tied, or one player is ahead but neither has crossed 1000, or the trailing player crossed 1000 without also being ahead — the game just continues to another round. No sudden-death or special-case logic required; the existing condition is self-resolving by construction.

**Game modes (§9, resolved)**: v1 offers two score targets, selectable before starting a game:
- **Standard**: first to (>1000 and strictly ahead), as above.
- **Quick**: same win condition, lower threshold (e.g. >300 and strictly ahead) — for a shorter mobile session. Purely a parameterized threshold, no other rule changes.

## 3. Design decisions made (resolving original ambiguities)

These were unspecified in the original rules and were decided explicitly, since they materially change the data model:

1. **Jokers are wildcards from the start** — placeable directly into any meld when it's first laid down, not only via the explicit swap-out action. (§2.3, §2.4)
2. **Shared tableau** — any player may add cards to any meld on the table, regardless of who laid it originally. Scoring tracks ownership per card, not per meld. (§2.3, §2.8)
3. **Empty closed pile ends the round immediately** — no reshuffle of the open row into a new closed pile. If the closed pile runs out, the round ends right there and both hands are scored as-is (loser penalty rule still applies to whoever has cards; if both have cards, both take their own hand penalty and neither gets the +50 winner bonus). This makes hoarding cards late in a round genuinely risky.
4. **Adding to a meld requires having come out, and cannot itself count as coming out** — closes the exploit an adversarial review found: without this, a player could score points off the opponent's melds forever without meeting the 40-point bar, or come out cheaply by dropping one card onto an opponent's existing triple. (§2.3, §2.4)
5. **A player who hasn't come out yet cannot draw from the open row at all** — only the closed pile. This removes the deadlock the review found between the cascade pickup's "must use it in a meld" obligation and the come-out gate: there's no longer a scenario where a player is forced to take cards they have no legal way to use. (§2.3, §2.5)
6. **No limit on repeat joker swap-and-replay** within a round, even though each swap moves up to 50 points of scoring between players — left as a deliberate skill/tempo battle rather than artificially capped. (§2.3)
7. **Turn 0 starter-card exchange rewritten as a standalone pre-rotation exchange** (§2.6) — fixes a self-contradiction in the original draft, where the second player was promised a single-card grace pickup that had already become physically impossible by the time their turn arrived under the normal cascade rule.

## 4. Persona review notes (design-quality sanity check)

- **Experienced Rummy/Gin player**: the open-row cascade pickup is the one mechanic that isn't just "Rummy with different names" — it adds a bluffing layer (bury a card to bait a costly pickup) that neither Gin Rummy's single discard pile nor standard Rummy's draw pile has. Worth protecting as the game's identity in marketing, not undersold as "yet another rummy."
- **Novice player**: the ruleset is dense (four point tiers, a 40-point/four-of-a-kind come-out gate, the opening-turn exception sequence, cascade pickup obligation). None of this is learnable from a rulebook alone in an app — needs an interactive tutorial and an AI-assisted "legal move" highlight for early hands, not just a text rules screen.
- **Hardcore/competitive player**: wants difficulty tiers on the AI, a hand-history/replay view, and eventually ranked online play with stats. Noted there's no Gin-style scaling bonus for winning with the opponent still holding a lot of deadwood (flat +50 regardless) — this reads as a deliberate simplicity choice, not an oversight; worth stating as such rather than silently "fixing" it later.
- **Joker volatility (flagged by adversarial review, not originally caught by any persona)**: because jokers are wild, the tableau is shared, and a swapped-out joker must be replayed the same turn, the same physical joker can repeatedly change hands across a round, each swap worth up to 50 points. With only 2 jokers in 54 cards, this is likely the single biggest score-swing mechanic in the game — left uncapped by design (§3, decision 6), but worth deliberately play-testing for, since it could dominate final scores more than the melds themselves.

## 5. Software architecture

### 5.1 Core principle

Build the **rules engine as a pure, deterministic, framework-agnostic module** (TypeScript) that has no concept of "human" vs. "AI" vs. "network peer" — only "player 1" and "player 2," each driven by an adapter. This is the one decision that's expensive to reverse later, so it's made up front even though multiplayer is out of scope for v1.

Engine responsibilities (fully unit-testable in isolation, independent of any UI):
- Deck construction, shuffle, deal.
- Turn state machine (Part 1 → Part 2 → Part 3, enforcing legality at each step).
- Meld validation (sets, runs, joker-wildcard fills, come-out threshold check).
- Open-row cascade pickup logic (§2.5), including the Turn 0 starter-card exchange (§2.6).
- Per-card ownership tracking for scoring.
- Round-end and game-end detection.

This engine is the natural place to encode every rule ambiguity resolved in §3 — each should have a corresponding unit test using the exact scenario that made it ambiguous.

### 5.2 Solo phase (v1 target)

- **Stack**: Expo / React Native, matching Appiness's proven toolchain and release pipeline (GitHub-hosted APK for sideload testing → Expo EAS build → Google Play once stable).
- **AI opponent**: a heuristic bot to start (minimize deadwood value, prioritize meeting the come-out threshold early, avoid discarding into a position that hands the human a large, useful cascade). Runs entirely on-device, calling the same engine API a human player's UI would call — no special-cased "AI turn" path. A stronger AI (minimax/MCTS over meld and discard choices) is a nice-to-have for a later difficulty tier, not a v1 requirement.
- **Persistence**: local only — expo-sqlite or AsyncStorage for match history, stats, and running score across rounds within a game.
- **No backend required for v1.**

### 5.3 Multiplayer (later phase, architecture reserved for now)

Because the engine is side-effect-free and doesn't assume client authority, the **rules logic** can later run server-side without a rewrite:
- Clients send intents (draw / meld action / discard) over WebSocket; the server runs the same engine, validates each intent, and broadcasts the resulting state.
- This is the standard anti-cheat shape for hidden-hand card games — a client-authoritative model would let a modified client see the opponent's hand or fabricate a legal-looking move.
- Natural host: the existing LXC Docker host (192.168.2.115), a small Node service, simple 2-player room/matchmaking.

**Caveat (from adversarial review, not to overstate this):** "no rewrite" only covers the rules logic. It does **not** solve the actually-hard part of multiplayer for a hidden-information game — per-viewer state redaction (the server must serve each client a filtered view with the opponent's hand hidden), session/reconnect handling, and matchmaking are all still unbuilt and unaddressed here. A pure engine is a solid foundation, not a finished multiplayer design — no need to design the rest further until solo v1 is validated and multiplayer is actually being scoped.

## 6. Naming

**Working title (downgraded from "chosen" — adversarial review): Cascade Sevens.**

Rationale: "Cascade" names the actual distinguishing mechanic (the overlapping open row); "Sevens" nods to the 7-card deal and the original Dutch working title *Zevenen* ("sevening"). A plain **"Cascade"** was rejected — it collides directly with an existing, very similar rummy-style card game ("Cascade (Card Game)" — sets/runs, 2–4 players, solo vs. CPU or online). "Stack & Match" was also considered and rejected — it's an exact existing title on Google Play (a tic-tac-toe-style match game, different genre but exact name collision). "Cascade Sevens" as a two-word combination returned no direct Google Play title collision at time of writing.

**Why this is only a working title, not locked:** the diligence so far was a couple of point-in-time web searches against Google Play title strings only. Before treating this name as final, still need: an App Store (iOS) check — the Expo/RN stack makes iOS distribution near-free later, so a collision found post-launch is a real cost; a basic trademark-register check (a name can clear every store's title search and still infringe a registered mark — there's also a physical card game called "Cascade" from Eagle-Gryphon Games, unrelated genre, worth a closer look); domain/social-handle availability; and a basic ASO sanity check, since "Cascade" and "Sevens" are both generic dictionary words that are each independently saturated in unrelated search results (waterfalls; the classic card game genre "Sevens"/Fan Tan) — clearing an exact-title collision check is a much lower bar than actually ranking in store search. Revisit before any store listing work begins.

## 7. Roadmap (proposed phases)

0. **Spike the cascade UI on a real phone screen** — before phase 1 starts (rules are now fully resolved, §9). The open row can grow to 15–25+ overlapping cards by late-round; tapping a specific buried card out of that on a small touchscreen is a real interaction-design risk, and the cascade is the game's whole identity (§4) — this isn't a "phase 3 polish" problem if it turns out unworkable, it's foundational. A rough mockup/prototype of just this interaction, before committing engine assumptions, is cheap insurance.
1. **Rules engine** — implement and unit-test the full ruleset above, including every §3 decision. Testing strategy: unit tests per rule (one per §3 decision, using the exact scenario that made it ambiguous), plus property-based/fuzz tests for invariants that should always hold (card count always conserves to 54; the AI never selects a move the legality-checker itself would reject), plus full-round simulation tests (engine plays itself out via the heuristic AI on both sides, thousands of times, checking nothing crashes or hangs). No UI yet.
2. **Local playable prototype** — bare-bones Expo UI, human vs. heuristic AI. **"Fun" gate, defined concretely rather than left as a vibe check:** a minimum number of full games actually played across multiple sessions (not just by whoever wrote the rules — that's a structurally biased n=1 sample), with specific friction points logged per session, before calling this phase done.
3. **Polish & tutorial** — proper UI/UX, interactive tutorial, legal-move highlighting, accessibility pass.
4. **GitHub sideload release** — APK for personal/friend testing, same as Appiness's pre-Play-Store phase.
5. **Google Play release** — via Expo EAS once stable. Needs an explicit privacy policy (required for the listing, especially once local stats/persistence exist) and store listing assets/copy as real tasks, not assumed-solved by the Appiness precedent — confirm what Appiness actually needed here rather than assuming it transfers.
6. **Multiplayer** — server-authoritative engine hosted on the LXC Docker host, WebSocket transport, matchmaking, and the hidden-hand state redaction the engine alone doesn't solve (§5.3). Scoped in detail only once v1 is live.

**Monetization**: deliberately left as an open decision, revisit later — not assumed free/no-ads by default.

## 8. Accessibility (carry over from Appiness precedent)

Reuse Appiness's `DESIGN.md` accessibility structure as the checklist baseline (WCAG AA contrast audit, dynamic type reflow, VoiceOver/TalkBack labeling, Reduce Motion alternatives) — adapt rather than redesign from scratch. Card games are naturally more screen-reader-friendly than the throw-based Kamelenrace mechanic, so full VoiceOver/TalkBack playability (not just menus) should be a realistic v1 target — revisit once the UI exists.

## 9. Open questions

All four rules ambiguities originally listed here were resolved on 2026-07-23 — see the "(§9, resolved)" tags at §2.3 (Ace in runs), §2.3/§2.7 (mid-turn instant win), and §2.9 (tie-break, quick-game mode).

One item remains open, deliberately deferred rather than blocking:
- **AI difficulty tiers**: how many, and what specifically differs (heuristic weights vs. a genuinely stronger search-based opponent) — deferred to §5.2/roadmap phase 2+, not blocking v1 engine work.

Still outstanding from the phase-0 roadmap item (§7): the mobile cascade-UI feasibility spike hasn't been done yet.
