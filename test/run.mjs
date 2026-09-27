/*
 * Runs every *.test.js suite in this folder and reports one result.
 *
 *   node test/run.mjs
 *
 * No dependencies: each suite is a plain Node script that exits non-zero on
 * failure, so anything CI-shaped can just run this file.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const suite of suites) {
  console.log("\n================ " + suite + " ================");
  const r = spawnSync(process.execPath, [join(here, suite)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(
  "\n" + (failed ? failed + " SUITE(S) FAILED" : "ALL " + suites.length + " SUITES PASSED")
);
process.exit(failed ? 1 : 0);
