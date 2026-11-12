/* global process, console, fetch, AbortSignal */
/**
 * ga4, gsc and sitepulse keep byte-identical copies of a few files. SHARED
 * lists each file and the repositories that carry it. This fails when a file
 * listed for this repository is missing here, when a file in a shared
 * directory is not listed, or when a sibling's main branch lacks a listed
 * file or holds a different copy. Run by the Shared check workflow; locally:
 * npm run check-shared.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OWNER = "printemps-tokyo";
const ALL = ["ga4", "gsc", "sitepulse"];
const SEARCH_CONSOLE = ["gsc", "sitepulse"];
const SHARED = {
  "scripts/check-shared.mjs": ALL,
  "src/shared/http.ts": ALL,
  "src/shared/google-auth.ts": ALL,
  "src/shared/pt-date.ts": SEARCH_CONSOLE,
  "test/shared/http.test.ts": ALL,
  "test/shared/google-auth.test.ts": ALL,
  "test/shared/pt-date.test.ts": SEARCH_CONSOLE,
};
const DIRS = ["src/shared", "test/shared"];

const self = JSON.parse(readFileSync("package.json", "utf8")).name.replace(/^@[^/]+\//, "");
if (!ALL.includes(self)) {
  console.error(`check-shared: unknown package ${self}`);
  process.exit(2);
}

let failed = 0;
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  failed++;
};

for (const dir of DIRS) {
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const file = `${dir}/${name}`;
    if (!SHARED[file]?.includes(self)) fail(`${file} is not listed for ${self} in scripts/check-shared.mjs`);
  }
}

let compared = 0;
for (const [file, repos] of Object.entries(SHARED)) {
  if (!repos.includes(self)) continue;
  if (!existsSync(file)) {
    fail(`${file} is missing here`);
    continue;
  }
  const local = readFileSync(join(file), "utf8");
  for (const repo of repos.filter((r) => r !== self)) {
    const url = `https://raw.githubusercontent.com/${OWNER}/${repo}/main/${file}`;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      fail(`${repo}/${file}: ${err.message}`);
      continue;
    }
    if (res.status === 404) {
      fail(`${repo} has no ${file} on main`);
      continue;
    }
    if (!res.ok) {
      fail(`${repo}/${file}: HTTP ${res.status}`);
      continue;
    }
    compared++;
    if ((await res.text()) !== local) fail(`${file} differs from ${repo} (${url})`);
    else console.log(`ok   ${file} = ${repo}`);
  }
}
console.log(`${compared} compared, ${failed} failed`);
process.exit(failed ? 1 : 0);
