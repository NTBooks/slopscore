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

function query(sql) {
  const argv = [wrangler, "d1", "execute", dbName, local ? "--local" : "--remote", "--env", env, "--json", "--command", sql];
  const raw = execFileSync(process.execPath, argv, { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(raw);
  return parsed[0].results;
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
