#!/usr/bin/env node
// Logical backup of a D1 database, table by table, through wrangler.
//
// Why not `wrangler d1 export`: it refuses databases with FTS5 virtual tables (we have repos_fts) and it takes the
// database offline while it runs. This reads every real table in pages of 500 rows with ordinary SELECTs, so the
// site keeps serving. Works locally with wrangler's OAuth login and in CI with CLOUDFLARE_API_TOKEN.
//
//   node scripts/backup.mjs [outDir] [--env production|test] [--local]
//
// Output: <outDir>/schema.sql, <outDir>/<table>.jsonl, <outDir>/manifest.json. Restore with scripts/restore.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = flag("--env") ?? process.env.WRANGLER_ENV ?? "production";
const local = args.includes("--local");
const dbName = process.env.D1_NAME ?? (env === "test" ? "slopscore-test" : "slopscore");
const outDir = args.find((a) => !a.startsWith("--") && a !== env) ?? join("backups", new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"));
const PAGE = 500;
// FTS5 shadow tables are rebuilt from `repos` on restore; sqlite_* are internal.
const SKIP = /^(sqlite_|repos_fts|_cf_)/;

// Run wrangler's JS entry point directly: no shell, so SQL with spaces and quotes survives on every platform.
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

// The Cloudflare API blips. A full export is dozens of sequential calls, and on 2026-09-13 a single "fetch failed"
// on the very first one threw away the whole nightly backup, so a call that fails gets a few more chances. A missing
// or malformed token will never come good no matter how long we wait, so those still stop on the first try.
const RETRY_DELAYS = [2000, 5000, 15000, 30000];
const HOPELESS = /CLOUDFLARE_API_TOKEN|Authorization header|Authentication error|\[code: (6003|6111|10000)\]/;
// Everything here is synchronous, and Atomics.wait is the only way to pause without turning the script async.
const sleep = (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function query(sql) {
  const argv = [wrangler, "d1", "execute", dbName, local ? "--local" : "--remote", "--env", env, "--json", "--command", sql];
  for (let attempt = 0; ; attempt++) {
    let raw;
    try {
      raw = execFileSync(process.execPath, argv, { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      // wrangler prints its error as JSON on stdout
      const out = `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim();
      if (attempt >= RETRY_DELAYS.length || HOPELESS.test(out)) {
        console.error(out);
        console.error(`gave up after ${attempt + 1} attempt(s) on: ${sql}`);
        process.exit(1);
      }
      const delay = RETRY_DELAYS[attempt];
      console.error(`query failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s: ${out.replace(/\s+/g, " ").slice(0, 200)}`);
      sleep(delay);
      continue;
    }
    return JSON.parse(raw)[0].results;
  }
}

mkdirSync(outDir, { recursive: true });
const objects = query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, name");
writeFileSync(join(outDir, "schema.sql"), objects.map((o) => `${o.sql};`).join("\n\n") + "\n");

const tables = objects.filter((o) => o.type === "table" && !SKIP.test(o.name)).map((o) => o.name);
const manifest = { database: dbName, env, at: new Date().toISOString(), tables: {} };
for (const t of tables) {
  const lines = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = query(`SELECT * FROM "${t}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`);
    for (const r of rows) lines.push(JSON.stringify(r));
    if (rows.length < PAGE) break;
  }
  writeFileSync(join(outDir, `${t}.jsonl`), lines.length ? lines.join("\n") + "\n" : "");
  manifest.tables[t] = lines.length;
  console.log(`${t}: ${lines.length} rows`);
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`backup written to ${outDir} (${tables.length} tables)`);
