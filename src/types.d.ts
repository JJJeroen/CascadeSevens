// Shared domain types for the Cascade Sevens rules engine, AI, and UI.
// See DESIGN.md for the ruleset these model.

export type Suit = "S" | "H" | "D" | "C";

export type RealRank =
  "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export type Rank = RealRank | "JOKER";

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit | null;
}

export type PlayerIdx = 0 | 1;

// A joker's suit is never independently meaningful (see engine.ts comments
// at the swap-in-place / run-position call sites) — only rank fixes what it
// stands for. `suit` exists solely because the UI's card label can show it
// when present; the engine itself never sets it.
export interface WildAs {
  rank: RealRank;
  suit?: Suit;
}

export interface MeldSlot {
  card: Card;
  ownerId: PlayerIdx;
  wildAs: WildAs | null;
}

export type MeldType = "set" | "run";

export interface Meld {
  id: string;
  type: MeldType;
  slots: MeldSlot[];
}

// A slot spec used to describe a meld before it's materialized (new-meld
// selections, resolved candidate slots) — cardId + optional wild assignment.
export interface SlotSpec {
  cardId: string;
  wildAs?: WildAs;
}

export type Turn0Stage = "starterFirst" | "otherSecond" | "starterFollowup";

export interface Turn0State {
  stage: Turn0Stage;
  resolved: boolean;
  lastAcceptor: PlayerIdx | null;
}

export interface LastDraw {
  source: "row";
  takenCards: Card[];
  priorObligations: string[];
  priorRowObligationCardId: string | null;
  // Part the turn was in when this take happened (a take after laying is
  // made in Part 2), so undoing it puts the player back where they were.
  partBefore: 1 | 2;
  // The still-undoable take before this one (none once a meld was laid in
  // between), so undo can step back through consecutive takes.
  previous: LastDraw | null;
}

// Active draft-then-commit tableau rearrange session (§2.3). Keyed by
// synthetic group ids ('g0', 'g1', ...); `groups`/`handPool` hold card ids
// only, resolved against `cardById` for rendering/validation.
export interface RearrangeSession {
  cardById: Record<string, Card>;
  originalOwnerByCardId: Record<string, PlayerIdx>;
  groups: Record<string, string[]>;
  handPool: string[];
  nextGroupId: number;
}

export interface ComeOutAttempt {
  meldIds: string[]; // melds laid this turn before coming out
  pendingObligations: string[]; // state from just before the first one
  rowObligationCardId: string | null;
  lastDraw: LastDraw | null;
  // Cascade takes made after the first of those melds (DESIGN.md decision
  // 24); taking the melds back returns these cards to the cascade too.
  laterTakes: LastDraw[];
}

// What the current player's turn looked like just before their first cascade
// take, or just AFTER a pile draw (never before it: the drawn card has been
// seen), so a stuck turn can be started over (DESIGN decision 25).
export interface TurnStart {
  part: 1 | 2; // where the player returns to

  hand: Card[];
  openRow: Card[];
  tableau: Meld[];
  comeOut: boolean;
  comeOutAccum: number;
}

export type RoundPart = "turn0" | 1 | 2 | 3;

export type EndReason = "handout" | "pile-empty";

export interface Round {
  closedPile: Card[];
  openRow: Card[];
  hands: [Card[], Card[]];
  tableau: Meld[];
  nextMeldSeq: number; // monotonic counter for meld ids -- see layNewMeld
  comeOut: [boolean, boolean];
  starter: PlayerIdx;
  current: PlayerIdx;
  part: RoundPart;
  turn0: Turn0State;
  pendingObligations: string[];
  rowObligationCardId: string | null;
  lastDraw: LastDraw | null;
  rearrange: RearrangeSession | null;
  rowDrawsThisPart1: number;
  turnStart: TurnStart | null; // set by the turn's first cascade take; null otherwise
  // Points of NEW melds the current player has laid THIS turn while not yet
  // come out (DESIGN.md 2.4, revised 2026-10-03: 40+ must be reached within a
  // single turn -- it no longer carries over). Must be 0 or the player has
  // come out before they may end the turn.
  comeOutAccum: [number, number];
  // What to restore if the player takes this turn's under-40 melds back.
  comeOutAttempt: ComeOutAttempt | null;
  log: string[];
  ended: boolean;
  endReason: EndReason | null;
  roundWinner: PlayerIdx | null;
  roundScores?: [number, number];
}

export type GameMode = "standard" | "quick";

export interface Game {
  mode: GameMode;
  threshold: number;
  scores: [number, number];
  roundNumber: number;
  gameOver: boolean;
  winner: PlayerIdx | null;
  round: Round | null;
  nextRoundStarter: PlayerIdx;
}

// --- Meld resolution result shapes -----------------------------------------

// tryAsSet/tryAsRun/validateNewMeldSelection: identifies WHAT type of meld a
// given (already-assigned) set of cards forms, without materializing slots.
export type MeldSelectionCheck =
  | { ok: true; type: "set"; rank: RealRank }
  | { ok: true; type: "run"; suit: Suit; aceHigh: boolean }
  | { ok: false; error: string };

// solveRun/resolveGroup/autoResolveMeld: solves an unassigned group of real
// cards + jokers into a concrete, orderable set of slots.
export type ResolveResult =
  | { ok: true; type: "set"; slots: SlotSpec[] }
  | { ok: true; type: "run"; suit: Suit; slots: SlotSpec[] }
  | { ok: false; error?: string };

export interface RearrangeGroupView {
  groupId: string;
  cardIds: string[];
  valid: boolean;
  type: MeldType | null;
}

export interface RearrangeStateView {
  groups: RearrangeGroupView[];
  handPool: string[];
}

export interface RearrangeProblem {
  groupId?: string;
  cardId?: string;
  cardIds?: string[];
  error: string;
}

export type CommitRearrangeResult =
  { ok: true } | { ok: false; problems: RearrangeProblem[] };

export interface AutoResolveAddToMeldResult {
  wildAs?: WildAs;
}

export interface MeldRunSeq {
  min: number;
  max: number;
  aceHigh: boolean;
}
