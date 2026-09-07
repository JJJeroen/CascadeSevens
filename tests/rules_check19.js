// Medium-tier: run-construction edge cases in solveRun/tryAsRun. Both jokers
// filling SEPARATE internal gaps at once (not just one joker extending an
// already-adjacent pair, which was the specific bug fixed 2026-07-27), and
// the 13-card span ceiling solveRun explicitly guards (`totalSize > 13`)
// but nothing previously exercised.
global.window = global;
require('../docs/engine.js');
const E = CascadeEngine;
function card(rank, suit) { return { id: `${rank}${suit || ''}`, rank, suit: suit || null }; }
function joker(n) { return { id: `JOKER-${n}`, rank: 'JOKER', suit: null }; }

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (e) { failures++; console.log(`FAIL: ${name} -> ${e.message}`); }
}

check('two jokers each fill a SEPARATE internal gap in the same run', () => {
  // 5,_,7,_,9 -- gaps at 6 and 8, one joker per gap.
  const hand = [card('5', 'H'), card('7', 'H'), card('9', 'H'), joker(1), joker(2)];
  const result = E.autoResolveMeld(hand, ['5H', '7H', '9H', 'JOKER-1', 'JOKER-2']);
  if (!result.ok || result.type !== 'run') throw new Error('expected a valid run, got ' + JSON.stringify(result));
  if (result.slots.length !== 5) throw new Error('expected 5 slots, got ' + result.slots.length);
  const jokerSlots = result.slots.filter((s) => s.cardId.startsWith('JOKER'));
  if (jokerSlots.length !== 2) throw new Error('expected both jokers placed');
  const wildRanks = jokerSlots.map((s) => s.wildAs.rank).sort().join(',');
  if (wildRanks !== '6,8') throw new Error('jokers should fill 6 and 8 respectively, got ' + wildRanks);
});

check('maximum legal run: exactly 13 cards (11 reals + 2 jokers filling 2 separate internal gaps)', () => {
  // A,2,3,4,5,_,7,_,9,10,J,Q,K -- missing 6 and 8, both internal.
  const reals = ['A', '2', '3', '4', '5', '7', '9', '10', 'J', 'Q', 'K'].map((r) => card(r, 'S'));
  const hand = [...reals, joker(1), joker(2)];
  const result = E.autoResolveMeld(hand, hand.map((c) => c.id));
  if (!result.ok || result.type !== 'run') throw new Error('a full 13-card run should be valid, got ' + JSON.stringify(result));
  if (result.slots.length !== 13) throw new Error('expected exactly 13 slots, got ' + result.slots.length);
});

check('exceeding the 13-card span is rejected even when the jokers are otherwise unnecessary', () => {
  // A..Q is already 12 consecutive reals with NO gap at all -- adding 2
  // spare jokers pushes the total to 14, over solveRun's explicit cap,
  // regardless of ace-low/ace-high interpretation.
  const reals = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'].map((r) => card(r, 'D'));
  const hand = [...reals, joker(1), joker(2)];
  const result = E.autoResolveMeld(hand, hand.map((c) => c.id));
  if (result.ok) throw new Error('a 14-card total should be rejected -- runs cap at 13 (a full suit), got ' + JSON.stringify(result));
});

console.log(failures === 0 ? '\nALL RULE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
