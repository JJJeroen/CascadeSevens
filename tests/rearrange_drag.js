// Rearrange draft: a card you pick up is visibly highlighted, and cards can be
// dragged (real mouse input) to a group, to "+ New group" and back to the hand.
import { findBrowser, startStaticServer, connect } from "./browser_harness.js";

const PORT = 8796;
const CDP_PORT = 9827;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => {
  console.log(`FAIL: ${m}`);
  failed = true;
  process.exitCode = 1; // a failure that returns early must still fail the run
};

async function main() {
  const browserBin = findBrowser();
  if (!browserBin) {
    console.log("SKIP: no Chromium/Chrome binary found on PATH");
    return;
  }
  const server = await startStaticServer(PORT);
  let page = null;
  try {
    page = await connect(browserBin, CDP_PORT);
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const q = (js) => page.evalJs(js);
    await page.send("Page.navigate", {
      url: `http://localhost:${PORT}/?test=1&t=${Date.now()}`,
    });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await q(`!!window.__cascadeTest?.getGame()`).catch(() => false))
        break;
    }
    await q(`window.__cascadeTest.disableAI()`);

    // Position: you have come out, a set of 9s (yours) is on the table, and
    // you hold the fourth 9 and a 2.
    await q(`(() => {
      const c = (id, rank, suit) => ({ id, rank, suit });
      const r = window.__cascadeTest.getGame().round;
      r.part = 2; r.current = 0; r.ended = false; r.rearrange = null;
      r.comeOut = [true, true]; r.pendingObligations = []; r.rowObligationCardId = null;
      r.lastDraw = null; r.comeOutAttempt = null;
      r.hands[0] = [c("9C", "9", "C"), c("2D", "2", "D"), c("KH", "K", "H")];
      r.tableau = [{ id: "m1", type: "set", slots: [
        { card: c("9S", "9", "S"), ownerId: 0, wildAs: null },
        { card: c("9H", "9", "H"), ownerId: 0, wildAs: null },
        { card: c("9D", "9", "D"), ownerId: 0, wildAs: null } ] }];
      window.__cascadeTest.render();
      document.querySelector("#startRearrangeBtn").click();
    })()`);
    const groups = () =>
      q(`[...document.querySelectorAll("#tableau .meld[data-group-id]")]
           .filter(m => m.dataset.groupId !== "new")
           .map(m => m.querySelectorAll(".card").length)`);
    const poolIds = () =>
      q(
        `[...document.querySelectorAll("#rearrangeHandPool .card")].map(c => c.dataset.cardId).sort()`,
      );

    if (JSON.stringify(await groups()) !== "[3]")
      return fail(
        `draft should start with one group of 3, got ${JSON.stringify(await groups())}`,
      );
    if (
      !(await q(
        `!!document.querySelector('#tableau .meld[data-group-id="new"]')`,
      ))
    )
      fail('the "+ New group" box is missing');

    // 1. Picking a card up must be visible: its look must change (the base
    // card already has an owner-stripe shadow, so "has a shadow" proves nothing).
    const look = () =>
      q(`(() => {
        const c = document.querySelector('#rearrangeHandPool .card[data-card-id="9C"]');
        const s = getComputedStyle(c);
        return { cls: c.classList.contains("selected"), shadow: s.boxShadow, transform: s.transform };
      })()`);
    const plain = await look();
    await q(
      `document.querySelector('#rearrangeHandPool .card[data-card-id="9C"]').click()`,
    );
    const sel = await look();
    if (
      !sel.cls ||
      (sel.shadow === plain.shadow && sel.transform === plain.transform)
    )
      fail(
        `a selected draft card must look different: ${JSON.stringify({ plain, sel })}`,
      );
    await q(
      `document.querySelector('#rearrangeHandPool .card[data-card-id="9C"]').click()`,
    ); // deselect

    // Real mouse drag, with a short hold like a finger.
    const send = (type, x, y) =>
      page.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
      });
    // Where to press on a card: its left edge strip (cards overlap, so the
    // middle of one can belong to its neighbour). Where to drop on a box: its middle.
    const point = (sel, strip) =>
      q(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
        e.scrollIntoView({ block: "center" });
        const b = e.getBoundingClientRect();
        return { x: ${strip} ? b.left + 10 : b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const drag = async (fromSel, toSel) => {
      const from = await point(fromSel, true);
      await send("mouseMoved", from.x, from.y);
      await send("mousePressed", from.x, from.y);
      await sleep(260); // longer than the hold time
      const to = toSel === null ? { x: 4, y: 4 } : await point(toSel, false);
      for (let i = 1; i <= 8; i++)
        await send(
          "mouseMoved",
          from.x + ((to.x - from.x) * i) / 8,
          from.y + ((to.y - from.y) * i) / 8,
        );
      await send("mouseReleased", to.x, to.y);
      await sleep(150);
    };
    const card = (id, where) => `${where} .card[data-card-id="${id}"]`;

    // 2. Drag the 9 from the draft hand onto the set: the group grows to 4.
    await drag(
      card("9C", "#rearrangeHandPool"),
      "#tableau .meld[data-group-id]:not([data-group-id='new'])",
    );
    if (JSON.stringify(await groups()) !== "[4]")
      fail(
        `dragging 9C onto the set should make a group of 4, got ${JSON.stringify(await groups())}`,
      );
    if (JSON.stringify(await poolIds()) !== '["2D","KH"]')
      fail(
        `the draft hand should be 2D, KH, got ${JSON.stringify(await poolIds())}`,
      );

    // 3. Drag the 2 to "+ New group": a second group appears.
    await drag(
      card("2D", "#rearrangeHandPool"),
      '#tableau .meld[data-group-id="new"]',
    );
    if (JSON.stringify(await groups()) !== "[4,1]")
      fail(
        `dragging 2D to "+ New group" should add a group, got ${JSON.stringify(await groups())}`,
      );

    // 4. Drag a card out of a group back to the draft hand.
    await drag(card("9C", "#tableau"), "#rearrangeHandPool");
    if (JSON.stringify(await groups()) !== "[3,1]")
      fail(
        `dragging 9C back to the hand should shrink the set, got ${JSON.stringify(await groups())}`,
      );
    if (JSON.stringify(await poolIds()) !== '["9C","KH"]')
      fail(
        `the draft hand should be 9C, KH, got ${JSON.stringify(await poolIds())}`,
      );

    // 4b. Dropping a card on its own group changes nothing (no reordering).
    const order = () =>
      q(
        `[...document.querySelectorAll("#tableau .meld[data-group-id]:not([data-group-id='new']) .card")].map(c => c.dataset.cardId).join(",")`,
      );
    const beforeOrder = await order();
    await drag(
      card("9S", "#tableau"),
      "#tableau .meld[data-group-id]:not([data-group-id='new'])",
    );
    if ((await order()) !== beforeOrder)
      fail(
        `dropping a card on its own group must not reorder it: ${beforeOrder} -> ${await order()}`,
      );

    // 4c. Empty table space is not a "+ New group" target: the card snaps back.
    const emptyPoint =
      await q(`(() => { const b = document.querySelector("#tableau").getBoundingClientRect();
      return { x: b.right - 8, y: b.top + 8 }; })()`);
    const groupsBefore = JSON.stringify(await groups());
    {
      const from = await point(card("KH", "#rearrangeHandPool"), true);
      await send("mouseMoved", from.x, from.y);
      await send("mousePressed", from.x, from.y);
      await sleep(260);
      for (let i = 1; i <= 8; i++)
        await send(
          "mouseMoved",
          from.x + ((emptyPoint.x - from.x) * i) / 8,
          from.y + ((emptyPoint.y - from.y) * i) / 8,
        );
      await send("mouseReleased", emptyPoint.x, emptyPoint.y);
      await sleep(150);
    }
    if (JSON.stringify(await groups()) !== groupsBefore)
      fail(
        `a drop on empty table space must not start a group: ${groupsBefore} -> ${JSON.stringify(await groups())}`,
      );

    // 5. Letting go on nothing changes nothing.
    await drag(card("KH", "#rearrangeHandPool"), null);
    if (JSON.stringify(await poolIds()) !== '["9C","KH"]')
      fail(
        `a drop on nothing should snap back, got ${JSON.stringify(await poolIds())}`,
      );
  } finally {
    if (page) {
      page.ws.close();
      page.child.kill();
    }
    server.close();
  }
  if (failed) process.exitCode = 1;
  else
    console.log(
      "OK: rearrange draft: selection is highlighted; drag to group, new group, hand and nowhere",
    );
}

main().catch((e) => {
  console.log(`FAIL: ${e.stack || e}`);
  process.exit(1);
});
