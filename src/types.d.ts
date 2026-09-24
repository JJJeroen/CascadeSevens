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

export type RoundPart = "turn0" | 1 | 2 | 3;

export type EndReason = "handout" | "pile-empty";

export interface Round {
  closedPile: Card[];
  openRow: Card[];
  hands: [Card[], Card[]];
  tableau: Meld[];
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
  comeOutAccum: [number, number];
  comeOutMetThisTurn: boolean;
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
  | { ok: true; type: "set"; rank: RealRank; isFourOfAKind: boolean }
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
