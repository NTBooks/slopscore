#!/usr/bin/env node
// Restore a scripts/backup.mjs directory into a D1 database.
//
//   node scripts/restore.mjs <backupDir> [--env production|test] [--local] [--yes-production]
//
// The target must already have the schema (run the migrations first). Rows go in with INSERT OR REPLACE in
// batches, parents before children, so restoring onto a live database overwrites matching ids and keeps rows the backup doesn't know.
// For a clean restore, start from an empty, migrated database.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = flag("--env") ?? process.env.WRANGLER_ENV ?? "production";
const local = args.includes("--local");
const dir = args.find((a) => !a.startsWith("--") && a !== env);
if (!dir) { console.error("usage: node scripts/restore.mjs <backupDir> [--env production|test] [--local] [--yes-production]"); process.exit(2); }
if (env === "production" && !local && !args.includes("--yes-production")) {
  console.error("Refusing to restore into production without --yes-production. Consider D1 Time Travel first: wrangler d1 time-travel restore slopscore --env production --timestamp=...");
  process.exit(2);
}
const dbName = process.env.D1_NAME ?? (env === "test" ? "slopscore-test" : "slopscore");
const BATCH = 200;              // rows per wrangler call
const FILE_BYTES = 2_000_000;   // or until the file is this big

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function run(sqlFile) {
  const argv = [wrangler, "d1", "execute", dbName, local ? "--local" : "--remote", "--env", env, "--yes", "--file", sqlFile];
  try {
    execFileSync(process.execPath, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // wrangler prints its error on stdout; surface it with the batch that failed
    console.error(`${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim());
    console.error(`failed batch kept at ${sqlFile}`);
    process.exit(1);
  }
}
const lit = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`;

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const tmp = join(tmpdir(), `d1-restore-${process.pid}.sql`);

// D1 enforces foreign keys, so parents go in before children: order tables by the REFERENCES in schema.sql.
function tableOrder(names) {
  const schema = readFileSync(join(dir, "schema.sql"), "utf8");
  const refs = new Map();
  for (const m of schema.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]*?)\);/gi)) {
    refs.set(m[1], [...m[2].matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((r) => r[1]).filter((r) => r !== m[1]));
  }
  const out = [];
  const seen = new Set();
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const p of refs.get(t) ?? []) if (names.includes(p)) visit(p); out.push(t); };
  for (const t of names) visit(t);
  return out;
}

const tables = tableOrder(readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)));
let total = 0;
for (const table of tables) {
  const file = `${table}.jsonl`;
  const rows = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.length) { console.log(`${table}: empty`); continue; }
  // One INSERT per row (D1 caps a single statement at 100 KB and a repos row with its README can be most of that),
  // many rows per file. defer_foreign_keys covers rows that reference later rows of the same table (comment replies).
  const cols = Object.keys(rows[0]);
  const head = `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES `;
  let stmts = [];
  let bytes = 0;
  const flush = () => { if (!stmts.length) return; writeFileSync(tmp, `PRAGMA defer_foreign_keys = ON;\n${stmts.join("\n")}\n`); run(tmp); stmts = []; bytes = 0; };
  for (const r of rows) {
    const stmt = `${head}(${cols.map((c) => lit(r[c])).join(",")});`;
    stmts.push(stmt);
    bytes += stmt.length;
    if (stmts.length >= BATCH || bytes > FILE_BYTES) flush();
  }
  flush();
  total += rows.length;
  console.log(`${table}: ${rows.length} rows (backup said ${manifest.tables[table] ?? "?"})`);
}
// repos_fts is kept in sync by the insert/delete triggers on repos, which INSERT OR REPLACE fires; no rebuild needed.
unlinkSync(tmp);
console.log(`restored ${total} rows into ${dbName} (${local ? "local" : env})`);
