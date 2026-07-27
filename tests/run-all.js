// Runs every rules_check*.js unit test file plus both headless AI-vs-AI
// simulations, in order, and reports a single pass/fail summary. This is
// the committed regression net for the engine (docs/engine.js) and AI
// (docs/ai.js) -- run it after any change to either file.
//
// Usage: node tests/run-all.js   (from anywhere; paths are __dirname-relative)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => /^(rules_check\d+|sim2|sim_stress)\.js$/.test(f))
  .sort((a, b) => {
    // rules_check2..13 in numeric order, then the two simulations last.
    const na = a.match(/\d+/);
    const nb = b.match(/\d+/);
    if (na && nb) return Number(na[0]) - Number(nb[0]);
    if (na) return -1;
    if (nb) return 1;
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
