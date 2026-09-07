// Runs every rules_check*.js unit test file plus every headless sim_*.js
// simulation/fuzz harness, in order, and reports a single pass/fail summary.
// This is the committed regression net for the engine (docs/engine.js) and
// AI (docs/ai.js) -- run it after any change to either file.
//
// Usage: node tests/run-all.js   (from anywhere; paths are __dirname-relative)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => /^(rules_check\d+|sim[\w-]*)\.js$/.test(f))
  .sort((a, b) => {
    // rules_check2..N in numeric order, then any sim*.js files last (alphabetically).
    const aIsSim = a.startsWith('sim');
    const bIsSim = b.startsWith('sim');
    if (aIsSim !== bIsSim) return aIsSim ? 1 : -1;
    if (!aIsSim) return Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]);
    return a.localeCompare(b);
  });

let failed = 0;
for (const f of files) {
  process.stdout.write(`=== ${f} ===\n`);
  try {
    const out = execFileSync('node', [path.join(dir, f)], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e) {
    failed++;
    process.stdout.write(e.stdout || '');
    process.stdout.write(`\n!!! ${f} FAILED (exit ${e.status}) !!!\n`);
  }
}

console.log(`\n${'='.repeat(40)}`);
console.log(failed === 0 ? `ALL ${files.length} TEST FILES PASSED` : `${failed}/${files.length} TEST FILES FAILED`);
process.exit(failed === 0 ? 0 : 1);
