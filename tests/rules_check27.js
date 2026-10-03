// Text hygiene: players must never see the old names. The app's vocabulary
// (Figma naming): pile, cascade, table, series, hand, round, turn, game. So no
// "open row" / "closed pile" / "the row", no "meld" / "tableau", and no "Part
// 1/2/3" (internal rule jargon) in anything the app can show.
//
// Scans the real string literals of the sources that produce visible text
// (comments and the code inside ${...} are ignored, so identifiers such as
// openRow or layMeldBtn don't matter) plus the page's visible text, titles
// and aria-labels.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD =
  /open row|closed pile|\bthe row\b|\bmeld(s|ed|ing)?\b|tableau|\bpart [123]\b/i;

// Minimal TypeScript literal extractor: returns the text of every "...",
// '...' and `...` literal (template expressions removed), skipping comments.
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      i = src.indexOf("*/", i) + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i + 1, j));
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      let depth = 0;
      let text = "";
      while (j < src.length) {
        if (src[j] === "\\") {
          text += src[j + 1];
          j += 2;
          continue;
        }
        if (src.startsWith("${", j)) {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0) {
          if (src[j] === "{") depth++;
          if (src[j] === "}") depth--;
          j++;
          continue;
        }
        if (src[j] === "`") break;
        text += src[j++];
      }
      out.push(text);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

let bad = 0;
const report = (file, text) => {
  bad++;
  console.log(`FAIL: ${file}: ${text.trim().slice(0, 150)}`);
};

for (const file of ["src/app.ts", "src/engine.ts", "src/ai.ts"]) {
  for (const lit of literals(readFileSync(path.join(root, file), "utf8"))) {
    // Only prose: DOM ids, class names, data kinds and selectors ("meld",
    // "tableau-empty", ".meld .card", "#tableau") are code, not visible text.
    const isCode = !/\s/.test(lit.trim()) || /^[.#[]/.test(lit.trim());
    if (!isCode && OLD.test(lit)) report(file, lit);
  }
}

const html = readFileSync(path.join(root, "docs/index.html"), "utf8").replace(
  /<!--[\s\S]*?-->/g,
  "",
);
const visible = [
  ...html.matchAll(/>([^<>]+)</g),
  ...html.matchAll(/\b(?:title|aria-label|placeholder)="([^"]*)"/g),
].map((m) => m[1]);
for (const text of visible) if (OLD.test(text)) report("docs/index.html", text);

if (bad > 0) process.exit(1);
console.log(
  `OK: no open row / closed pile / meld / tableau / Part N in the visible text of the app, engine, AI and page.`,
);
