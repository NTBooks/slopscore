// Known-vulnerable dependencies: GitHub's SBOM (dependency graph) → OSV.dev batch query. A badge, not a gate.
import type { GitHub } from "./github";

export interface VulnSummary {
  checked_at: number;
  deps: number;              // packages we could map to an OSV ecosystem
  vulnerable: number;        // of those, how many have at least one advisory
  sample: { name: string; version: string; ids: string[] }[];
  note?: string;
}

interface SbomPackage { name: string; versionInfo?: string; externalRefs?: { referenceType: string; referenceLocator: string }[] }
interface Sbom { sbom?: { packages?: SbomPackage[] } }

const ECO: Record<string, string> = {
  npm: "npm", pypi: "PyPI", cargo: "crates.io", golang: "Go", maven: "Maven", nuget: "NuGet", gem: "RubyGems",
  composer: "Packagist", hex: "Hex", pub: "Pub", swift: "SwiftURL", cocoapods: "CocoaPods",
};

/** purl → {ecosystem, name, version} for ecosystems OSV knows. */
export function fromPurl(purl: string): { ecosystem: string; name: string; version: string } | null {
  const m = /^pkg:([a-z]+)\/(.+?)(?:@([^?#]+))?(?:[?#].*)?$/i.exec(purl);
  if (!m) return null;
  const eco = ECO[m[1].toLowerCase()];
  if (!eco || !m[3]) return null;
  let name = decodeURIComponent(m[2]);
  if (eco === "Maven") name = name.replace("/", ":");
  return { ecosystem: eco, name, version: decodeURIComponent(m[3]) };
}

export async function vulnerableDeps(gh: GitHub, owner: string, repo: string, maxPackages = 1000): Promise<VulnSummary> {
  const t = Math.floor(Date.now() / 1000);
  const r = await gh.get<Sbom>(`/repos/${owner}/${repo}/dependency-graph/sbom`);
  if (r.status !== 200 || !r.data?.sbom?.packages) return { checked_at: t, deps: 0, vulnerable: 0, sample: [], note: r.status === 404 ? "no dependency graph (no manifest, or disabled)" : `sbom ${r.status}` };
  const pkgs = r.data.sbom.packages
    .map((p) => p.externalRefs?.find((x) => x.referenceType === "purl")?.referenceLocator)
    .filter((x): x is string => Boolean(x))
    .map(fromPurl)
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .slice(0, maxPackages);
  if (!pkgs.length) return { checked_at: t, deps: 0, vulnerable: 0, sample: [], note: "no mappable packages" };

  let vulnerable = 0;
  const sample: VulnSummary["sample"] = [];
  for (let i = 0; i < pkgs.length; i += 500) {
    const chunk = pkgs.slice(i, i + 500);
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
    });
    if (!res.ok) return { checked_at: t, deps: pkgs.length, vulnerable, sample, note: `osv ${res.status}` };
    const j = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    j.results.forEach((x, k) => {
      if (x.vulns?.length) {
        vulnerable++;
        if (sample.length < 8) sample.push({ name: chunk[k].name, version: chunk[k].version, ids: x.vulns.slice(0, 3).map((v) => v.id) });
      }
    });
  }
  return { checked_at: t, deps: pkgs.length, vulnerable, sample };
}
