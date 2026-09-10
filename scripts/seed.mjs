// Emits SQL that seeds ~20 fake repos with varied disclosures, votes, comments, a rejected one, a quarantined one,
// a discovered one, and WIP entries. Usage: node scripts/seed.mjs > .seed.sql && wrangler d1 execute slopscore --local --file .seed.sql
const EPOCH = 1_700_000_000;
const now = Math.floor(Date.now() / 1000);
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const hot = (up, down, t) => { const s = up - down; const o = Math.log10(Math.max(Math.abs(s), 1)); const sign = s > 0 ? 1 : s < 0 ? -1 : 0; return Math.round((sign * o + (t - EPOCH) / 45000) * 1e7) / 1e7; };
const contro = (up, down) => (up <= 0 || down <= 0 ? 0 : Math.round(Math.pow(up + down, up > down ? down / up : up / down) * 1e4) / 1e4);

const users = [
  [101, "slopfarmer", 1400000000, 12, 40], [102, "trough-inspector", 1500000000, 3, 5], [103, "vibecoder99", now - 90 * 86400, 2, 0],
  [104, "agent-smith", 1600000000, 30, 300], [105, "newbie", now - 2 * 86400, 0, 0], [106, "orgbot", 1450000000, 8, 10], [107, "clippy", 1300000000, 50, 900],
];
const tools = ["claude-code", "cursor", "copilot", "codex", "gemini-cli", "windsurf", "aider", "lovable", "chatgpt"];
const cats = ["devtools", "cli", "web-app", "game", "bot", "agent", "mcp-server", "automation", "toy", "iot", "productivity", "data"];
const langs = ["TypeScript", "Python", "Rust", "Go", "JavaScript", "C#", "Ruby"];
const statuses = ["works-on-my-machine", "alpha", "beta", "stable", "prototype", "idea", "maintained", "abandoned"];
const names = [
  ["toastwatch", "Notifies you when toast is done. Needs a webcam and faith."], ["yaml2regret", "Converts YAML to regret, losslessly."], ["nap-scheduler", "Cron for humans who nap."],
  ["pigeon-mcp", "An MCP server that asks a pigeon."], ["excel-but-worse", "A spreadsheet with exactly one cell."], ["gitblame-me", "Rewrites git blame so it's always you."],
  ["dark-mode-for-cli", "Makes your terminal darker. Somehow."], ["todo-todo", "A todo app for tracking todo apps."], ["llm-coinflip", "Asks four models to flip a coin, averages the result."],
  ["fridge-api", "REST API for your fridge. GET /milk returns 404."], ["autoreply-9000", "Replies to every email with 'sounds good'."], ["kanban-for-cats", "Drag-and-drop tasks. The cat drags them back."],
  ["weather-guesser", "Guesses the weather. Never checks."], ["rubber-duck-agent", "An agent that only says 'hm, interesting'."], ["semver-roulette", "Bumps a random version segment on every commit."],
  ["screenshot-to-startup", "Turns a screenshot into a pitch deck and a Series A."], ["pixel-farm", "Idle game where the pixels farm you."], ["recipe-diff", "git diff, but for soup."],
  ["meeting-summarizer-summarizer", "Summarizes your meeting summaries."], ["slopscore", "This site. Peer review for code nobody wrote."],
  ["nudge-bot", "Slack bot that nudges. Only nudges."], ["ascii-cinema-4k", "Streams movies as ASCII at 4K. Terminal not included."],
];

const out = [];
out.push("PRAGMA foreign_keys = OFF;");
for (const [id, login, created, repos, followers] of users) {
  out.push(`INSERT OR REPLACE INTO users (id, login, avatar_url, gh_created_at, public_repos, followers) VALUES (${id}, ${q(login)}, ${q(`https://avatars.githubusercontent.com/u/${id}?v=4`)}, ${created}, ${repos}, ${followers});`);
}

let rid = 5000;
names.forEach(([name, tagline], i) => {
  rid += 1;
  const owner = users[i % users.length];
  const t = now - Math.floor((i * 7 + 3) * 3600 * 4);
  const up = Math.max(0, 25 - i * 2 + (i % 3) * 4);
  const down = i % 4 === 0 ? Math.floor(up / 3) : i % 5;
  let status = "listed"; let queue = null; let reject = null; let risk = 5 + (i * 7) % 30; let policy = null;
  if (i === 3) { status = "rejected"; policy = "contract"; reject = "slopscore.md paperwork: human_touch must be one of: none, light, heavy; category has an unknown value; allowed: devtools, cli, ..."; }
  if (i === 8) { status = "rejected"; policy = "content"; reject = "Content policy: contains \"sexual\" flagged by Llama Guard but not disclosed"; }
  if (i === 11) { status = "quarantined"; queue = "awaiting-review"; risk = 72; }
  if (i === 14) { status = "discovered"; queue = "awaiting-scan"; }
  if (i === 17) { status = "discovered"; queue = "ai-budget"; }
  if (i === 20) { status = "delisted"; }
  const wip = statuses[i % statuses.length];
  const meta = {
    slopscore: 1, ai_generated: ["entirely", "mostly", "entirely", "partly"][i % 4], human_touch: ["light", "none", "heavy"][i % 3], content_rating: "everyone",
    contains: i % 6 === 0 ? ["scraping"] : i % 9 === 0 ? ["crypto", "mild-language"] : [], category: [cats[i % cats.length], ...(i % 2 ? [cats[(i + 3) % cats.length]] : [])], status: wip,
    built_with: [tools[i % tools.length], ...(i % 3 === 0 ? [tools[(i + 1) % tools.length]] : [])], models: ["claude-fable-5-1"], interface: [i % 2 ? "cli" : "web"], frameworks: i % 2 ? [] : ["hono"],
    platforms: ["linux", ...(i % 2 ? ["docker"] : [])], audience: ["developers"], data: ["local-only"], needs: [], domain: [], tags: ["seed", `t${i % 5}`], images: [], maintainers: [], unlisted: false, x: {},
  };
  const gates = [{ gate: "metadata", ok: true, reasons: [] }, { gate: "contract", ok: policy !== "contract", reasons: policy === "contract" ? [reject] : [] }];
  if (policy === "content") gates.push({ gate: "content", ok: false, reasons: [reject] });
  const scan = { at: t, gates, policy: policy ?? undefined, warnings: [] };
  const tier = status === "listed" && i % 3 === 0 ? "submitted" : "found";
  const bodyMd = `## Why\n\nBecause an agent could. **${name}** was built in one sitting with ${meta.built_with[0]}.\n\n- It ${i % 2 ? "works" : "mostly works"}\n- Zero tests, ${i * 3 + 7} commits\n\n\`\`\`\nnpx ${name}\n\`\`\``;
  const bodyHtml = `<h3>Why</h3><p>Because an agent could. <strong>${name}</strong> was built in one sitting with ${meta.built_with[0]}.</p><ul><li>It ${i % 2 ? "works" : "mostly works"}</li><li>Zero tests, ${i * 3 + 7} commits</li></ul><pre><code>npx ${name}</code></pre>`;
  const gh = { description: tagline, homepage: i % 4 === 0 ? `https://${name}.example.com` : null, topics: ["ai", cats[i % cats.length]], watchers: up, open_issues: i, size: 120 + i * 30, owner_avatar: `https://avatars.githubusercontent.com/u/${owner[0]}?v=4` };
  const listedAt = status === "listed" ? t : null;
  out.push(`INSERT OR REPLACE INTO repos (id, full_name, owner, name, owner_id, owner_type, default_branch, title, tagline, demo_url, stars, forks, language, license, pushed_at, gh_created_at, gh, md_sha, md_updated_at, meta, body_md, body_html, status, tier, submitted_by, submitted_at, queue_reason, risk, reject_reason, scan, up, down, score, hot, controversy, comment_count, first_seen, listed_at, last_crawled, next_crawl, removed_at, removed_reason)
VALUES (${rid}, ${q(`${owner[1]}/${name}`)}, ${q(owner[1])}, ${q(name)}, ${owner[0]}, 'User', 'main', ${q(name)}, ${q(tagline)}, ${q(gh.homepage)}, ${Math.floor(up * 13 + i)}, ${i}, ${q(langs[i % langs.length])}, ${q(i % 3 ? "MIT" : "Apache-2.0")}, ${t - 3600}, ${t - 86400 * (10 + i)}, ${q(JSON.stringify(gh))}, ${q(`sha${rid}`)}, ${t}, ${q(JSON.stringify(meta))}, ${q(bodyMd)}, ${q(bodyHtml)}, ${q(status)}, ${q(tier)}, ${tier === "submitted" ? owner[0] : "NULL"}, ${tier === "submitted" ? t + 3600 : "NULL"}, ${q(queue)}, ${risk}, ${q(reject)}, ${q(JSON.stringify(scan))}, ${up}, ${down}, ${up - down}, ${hot(up, down, t)}, ${contro(up, down)}, 0, ${t - 600}, ${listedAt ?? "NULL"}, ${t}, ${t + 3600}, ${status === "delisted" ? t + 7200 : "NULL"}, ${status === "delisted" ? "'owner-request'" : "NULL"});`);
  const tags = [];
  for (const f of ["category", "ai_generated", "human_touch", "status", "contains", "built_with", "models", "interface", "frameworks", "platforms", "audience", "data", "tags"]) {
    const v = meta[f]; (Array.isArray(v) ? v : [v]).forEach((x) => tags.push([f, x, "declared"]));
  }
  tags.push(["language", langs[i % langs.length].toLowerCase().replace("#", "sharp"), "detected"]);
  gh.topics.forEach((x) => tags.push(["topic", x, "detected"]));
  tags.push(["license", (i % 3 ? "mit" : "apache-2.0"), "detected"]);
  for (const [f, v, s] of tags) out.push(`INSERT OR IGNORE INTO repo_tags (repo_id, facet, value, source, recognized) VALUES (${rid}, ${q(f)}, ${q(v)}, ${q(s)}, 1);`);
  out.push(`UPDATE repos SET tags_flat = ${q(tags.map(([f, v]) => `${f}:${v} ${v}`).join(" "))} WHERE id = ${rid};`);
  out.push(`INSERT INTO repo_versions (repo_id, md_sha, meta, body_md, stars, seen_at) VALUES (${rid}, ${q(`sha${rid}`)}, ${q(JSON.stringify(meta))}, ${q(bodyMd)}, ${up * 13}, ${t});`);
  // votes: distribute among users
  let u = up, d = down; let k = 0;
  for (const usr of users) { if (u > 0 && k % 2 === 0) { out.push(`INSERT OR IGNORE INTO votes (user_id, repo_id, value, created_at) VALUES (${usr[0]}, ${rid}, 1, ${t + k * 100});`); u--; } else if (d > 0) { out.push(`INSERT OR IGNORE INTO votes (user_id, repo_id, value, created_at) VALUES (${usr[0]}, ${rid}, -1, ${t + k * 100});`); d--; } k++; }
  if (status === "listed") {
    out.push(`INSERT INTO comments (repo_id, user_id, parent_id, body_md, body_html, up, down, created_at) VALUES (${rid}, ${owner[0]}, NULL, ${q("Maker here. It runs on my machine, which is the status I declared, so technically this is stable.")}, ${q("<p>Maker here. It runs on my machine, which is the status I declared, so technically this is stable.</p>")}, 3, 0, ${t + 500});`);
    out.push(`INSERT INTO comments (repo_id, user_id, parent_id, body_md, body_html, up, down, created_at) VALUES (${rid}, ${users[(i + 2) % users.length][0]}, NULL, ${q(`Graded. ${i % 2 ? "Genuinely useful slop." : "The README is longer than the code. 7/10."}`)}, ${q(`<p>Graded. ${i % 2 ? "Genuinely useful slop." : "The README is longer than the code. 7/10."}</p>`)}, ${i % 5}, ${i % 2}, ${t + 900});`);
    out.push(`UPDATE repos SET comment_count = 2 WHERE id = ${rid};`);
  }
});
// awards: yesterday's day winner + a week winner
const yesterday = new Date((now - 86400) * 1000).toISOString().slice(0, 10);
out.push(`INSERT OR IGNORE INTO awards (repo_id, kind, period, rank, score) VALUES (5001, 'day', '${yesterday}', 1, 25), (5004, 'day', '${yesterday}', 2, 20), (5007, 'day', '${yesterday}', 3, 15);`);
out.push(`INSERT OR IGNORE INTO awards (repo_id, kind, period, rank, score) VALUES (5001, 'week', '${yesterday.slice(0, 8)}W1', 1, 25);`);
out.push(`INSERT OR IGNORE INTO mod_log (actor_login, actor_role, action, target_type, target_id, target_label, note) VALUES ('slopfarmer', 'owner', 'remove', 'repo', 5021, 'slopfarmer/nudge-bot', 'owner request'), ('system', 'system', 'quarantine', 'repo', 5012, 'orgbot/kanban-for-cats', 'risk 72: new account, one commit, binaries at root');`);
out.push(`INSERT OR IGNORE INTO stats_daily (date, neurons_used, neurons_budget, scans, deferred, found, listed, rejected, quarantined) VALUES ('${yesterday}', 8100, 9000, 34, 6, 41, 30, 3, 1);`);
console.log(out.join("\n"));
