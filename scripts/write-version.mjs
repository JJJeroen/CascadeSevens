// Writes docs/version.json (gitignored) at build time. The app version is
// "0.<number of the last merged PR>", e.g. 0.54, so a build can be matched to
// the PR it came from without anyone maintaining a version by hand.
//
// The number comes from the most recent "Merge pull request #N" commit
// reachable from HEAD. On main that is the HEAD commit itself, which also
// works in a shallow CI checkout. Without any such commit it falls back to
// "dev".
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const subject = git("log", "-1", "--grep=^Merge pull request #", "--format=%s");
const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1] ?? null;
const commit =
  (process.env.GITHUB_SHA ?? "").slice(0, 7) ||
  git("rev-parse", "--short", "HEAD");

const info = {
  version: pr ? `0.${pr}` : "dev",
  pr: pr ? Number(pr) : null,
  commit: commit || "unknown",
};
writeFileSync(
  path.join(root, "docs", "version.json"),
  JSON.stringify(info) + "\n",
);
console.log(`version ${info.version} (commit ${info.commit})`);
