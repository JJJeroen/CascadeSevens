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

Full ruleset from DESIGN.md: deck/deal, Turn 0 starter-card exchange (§2.6),
draw from closed pile or open-row cascade pickup (§2.5, gated on having come
out), the 40-point/four-of-a-kind come-out gate (§2.4), new melds (sets and
runs, Ace anchoring either end with no wraparound), adding to any meld on the
shared tableau, joker wildcards placed directly into melds, joker swap-out
with the same-turn replay obligation, per-card ownership scoring, closed-pile
empty ending the round immediately (§3 decision 3), and the two-part
(>1000-or->300 and strictly ahead) game-end condition (§2.9).

Verified with a headless simulation (both seats played by the bot) across
1,600+ rounds with no stalls and full 54-card conservation every round, plus
targeted checks for the come-out gate, Ace anchoring/no-wraparound, the Turn
0 exchange's row-length-1 invariant under all three resolution paths, and the
joker swap replay obligation.

## Known simplifications (mock, not final spec)

- **Come-out accumulation resets every turn**, not tracked across turns. If
  a player lays new melds pre-come-out that don't reach 40 in that same
  turn, those melds stay on the table (and score for them) but the player
  remains "not come out" — DESIGN.md doesn't fully specify this edge case;
  this is a reasonable reading, not a verified-correct one.
- **Joker wildcard rank/suit entry uses `prompt()` dialogs**, not a proper
  picker UI — fine for testing legality/flow, not representative of final
  UX.
- **AI is a greedy heuristic** (first candidate meld found, cheapest-looking
  row pickups only) — not the phase-2 AI, and not tuned for a good game feel.
- **No persistence** — refreshing the page loses game state.
