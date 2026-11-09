// A new meld may not use the same card id twice: layNewMeld used to splice(-1)
// a different card out of the hand (found in the online-play review).
import { CascadeEngine } from "../docs/engine.js";
const E = CascadeEngine;

const game = E.newGame("standard", () => 0.1);
E.startRound(game, () => 0.5);
E.turn0Decline(game);
E.turn0Decline(game);
const r = game.round;
r.current = 0;
r.part = 2;
r.comeOut = [true, true];
const hand = r.hands[0];
const id = hand[0].id;
const before = hand.map((c) => c.id).join();
let msg = "";
try {
  E.layNewMeld(game, [{ cardId: id }, { cardId: id }, { cardId: id }]);
} catch (e) {
  msg = e.message;
}
if (!/twice/.test(msg) || hand.map((c) => c.id).join() !== before) {
  console.log(`FAIL: duplicate ids accepted or hand changed (${msg})`);
  process.exit(1);
}
console.log("OK: duplicate card ids in a meld are rejected");
