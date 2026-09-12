// Write skills/slopscore/SKILL.md from src/lib/skill.ts.
//
// Why the file exists at all: every skill registry — localskills.sh, skills.sh, SkillsMP, claudeskills.club,
// skills.pub, the git-based Claude Code marketplaces — finds skills by looking at files in a GitHub repo. A URL
// a Worker renders on demand (/skill.md) is invisible to all of them, and it was the only copy we had. This is
// the copy they can see, and it is generated so it can never say something different from the one we serve.
//
//   npm run skill            write it
//   npm run skill -- --check exit 1 if it is stale
//
// The source is bundled with esbuild rather than imported directly: the TypeScript here uses extensionless
// imports, which Node's own resolver will not follow. esbuild comes with wrangler, so this adds no dependency.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "skills", "slopscore", "SKILL.md");
const check = process.argv.includes("--check");

// Bundled inside the project, not in the OS temp dir: externalised packages have to resolve from
// node_modules, and node_modules is found by walking up from the file doing the importing.
const tmp = path.join(root, "node_modules", ".cache", "slopscore-skill.mjs");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "lib", "skill.ts")],
  outfile: tmp,
  bundle: true,
  format: "esm",
  platform: "node",
  // Dependencies stay external: bundling a CommonJS package (yaml, via slopmd) into ESM breaks on its
  // internal require(). Node imports them from node_modules the normal way.
  packages: "external",
  logLevel: "warning",
});
const { skillMd, CANONICAL_ORIGIN } = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, { force: true });

const wanted = skillMd(CANONICAL_ORIGIN);
const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;

if (current === wanted) {
  console.log(`skills/slopscore/SKILL.md is current (${wanted.length} bytes)`);
  process.exit(0);
}
if (check) {
  console.error(current === null
    ? "skills/slopscore/SKILL.md is missing. Run: npm run skill"
    : "skills/slopscore/SKILL.md is stale. Run: npm run skill");
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, wanted);
console.log(`${current === null ? "created" : "updated"} skills/slopscore/SKILL.md (${wanted.length} bytes)`);
