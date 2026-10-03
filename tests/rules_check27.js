// Text hygiene: players must never see the old names "open row", "closed pile"
// or "the row" (they are the "cascade" and the "pile" -- Figma naming). Scans
// the prose of the sources that produce visible text, comments excluded
// (identifiers like openRow / .open-row have no space, so they don't match).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD = /open row|closed pile|\bthe row\b/i;
const files = ["src/app.ts", "src/engine.ts", "src/ai.ts", "docs/index.html"];

function withoutComments(text, file) {
  if (file.endsWith(".html")) return text.replace(/<!--[\s\S]*?-->/g, "");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

let bad = 0;
for (const file of files) {
  const text = withoutComments(
    readFileSync(path.join(root, file), "utf8"),
    file,
  );
  text.split("\n").forEach((line) => {
    if (OLD.test(line)) {
      bad++;
      console.log(`FAIL: ${file}: ${line.trim().slice(0, 140)}`);
    }
  });
}
if (bad > 0) process.exit(1);
console.log(
  `OK: no "open row" / "closed pile" / "the row" in the text of ${files.length} files.`,
);
