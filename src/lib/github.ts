// GitHub client. ETag-aware (304 = free), rate-limit-aware, follows nothing automatically (301 = rename, handled by callers).

export interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string; id: number; type: string; avatar_url: string };
  description: string | null;
  homepage: string | null;
  topics?: string[];
  language: string | null;
  license: { spdx_id: string | null; key: string } | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  size: number;
  created_at: string;
  pushed_at: string;
  updated_at: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  is_template?: boolean;
  private: boolean;
  default_branch: string;
  parent?: { full_name: string; stargazers_count: number };
}

export interface GhUser {
  id: number;
  login: string;
  avatar_url: string;
  created_at: string;
  public_repos: number;
  followers: number;
  type: string;
}

export interface GhContentsEntry { name: string; path: string; sha: string; size: number; type: "file" | "dir" | "symlink" | "submodule" }
export interface GhRelease { tag_name: string; name: string | null; published_at: string | null; html_url: string }
export interface GhCommunity { health_percentage: number; files: Record<string, unknown | null>; content_reports_enabled?: boolean }
export interface GhCodeSearchItem { name: string; path: string; sha: string; repository: { id: number; full_name: string; fork: boolean; private: boolean; owner: { login: string } } }

export type GhResult<T> =
  | { status: 200; data: T; etag: string | null; headers: Headers }
  | { status: 304; data: null; etag: string | null }
  | { status: number; data: null; etag: null; error: string; blocked?: boolean; redirect?: string };

const UA = "slopscore-crawler (+https://slopscore.org)";

export class GitHub {
  /** Remaining core-API calls per the last response; null until we've made one. */
  remaining: number | null = null;
  resetAt: number | null = null;
  calls = 0;

  constructor(private token?: string) {}

  get authed() { return Boolean(this.token); }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = {
      "user-agent": UA,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  /** True when the last response said we're (nearly) out of calls and the window hasn't reset. */
  throttled(): boolean {
    if (this.remaining == null || this.resetAt == null) return false;
    return this.remaining < 5 && this.resetAt > Date.now() / 1000;
  }

  async get<T>(path: string, opts: { etag?: string | null; accept?: string; raw?: boolean } = {}): Promise<GhResult<T>> {
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const extra: Record<string, string> = {};
    if (opts.etag) extra["if-none-match"] = opts.etag;
    if (opts.accept) extra.accept = opts.accept;
    this.calls++;
    const res = await fetch(url, { headers: this.headers(extra), redirect: "manual" });
    const rem = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (rem != null) this.remaining = Number(rem);
    if (reset != null) this.resetAt = Number(reset);
    const etag = res.headers.get("etag");
    if (res.status === 304) return { status: 304, data: null, etag };
    if (res.status === 200) {
      const data = (opts.raw ? await res.text() : await res.json()) as T;
      return { status: 200, data, etag, headers: res.headers };
    }
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      return { status: res.status, data: null, etag: null, error: "redirect", redirect: res.headers.get("location") ?? undefined };
    }
    let error = res.statusText;
    let blocked = false;
    try {
      const body = (await res.json()) as { message?: string; block?: unknown };
      error = body.message ?? error;
      blocked = Boolean(body.block) || /access blocked|repository access blocked|unavailable for legal/i.test(error);
    } catch { /* ignore */ }
    return { status: res.status, data: null, etag: null, error, blocked };
  }

  async post<T>(path: string, body: unknown, opts: { accept?: string; raw?: boolean } = {}): Promise<GhResult<T>> {
    this.calls++;
    const res = await fetch(`https://api.github.com${path}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", ...(opts.accept ? { accept: opts.accept } : {}) }),
      body: JSON.stringify(body),
    });
    const rem = res.headers.get("x-ratelimit-remaining");
    if (rem != null) this.remaining = Number(rem);
    if (res.status === 200) return { status: 200, data: (opts.raw ? await res.text() : await res.json()) as T, etag: null, headers: res.headers };
    return { status: res.status, data: null, etag: null, error: res.statusText };
  }

  repo(owner: string, name: string, etag?: string | null) {
    return this.get<GhRepo>(`/repos/${owner}/${name}`, { etag });
  }
  languages(owner: string, name: string) {
    return this.get<Record<string, number>>(`/repos/${owner}/${name}/languages`);
  }
  /** README rendered and sanitised by GitHub itself. */
  readmeHtml(owner: string, name: string, etag?: string | null) {
    return this.get<string>(`/repos/${owner}/${name}/readme`, { etag, accept: "application/vnd.github.html", raw: true });
  }
  contents(owner: string, name: string, etag?: string | null) {
    return this.get<GhContentsEntry[]>(`/repos/${owner}/${name}/contents/`, { etag });
  }
  latestRelease(owner: string, name: string) {
    return this.get<GhRelease>(`/repos/${owner}/${name}/releases/latest`);
  }
  community(owner: string, name: string) {
    return this.get<GhCommunity>(`/repos/${owner}/${name}/community/profile`);
  }
  /** Contributor count from the Link: rel="last" page number (1 call regardless of size). */
  async contributorsCount(owner: string, name: string): Promise<number | null> {
    const r = await this.get<unknown[]>(`/repos/${owner}/${name}/contributors?per_page=1&anon=1`);
    if (r.status !== 200 || !("headers" in r) || !r.data) return null;
    const link = r.headers.get("link") ?? "";
    const m = /[?&]page=(\d+)>; rel="last"/.exec(link);
    return m ? Number(m[1]) : r.data.length;
  }
  /** Marker-file commits, newest first, one item: gives the file's last change without downloading it. */
  markerCommit(owner: string, name: string, etag?: string | null) {
    return this.get<{ sha: string; commit: { committer: { date: string } } }[]>(`/repos/${owner}/${name}/commits?path=slopscore.md&per_page=1`, { etag });
  }
  /** Code search for marker files. Requires a token. 30 req/min. */
  codeSearch(page = 1, sort: "indexed" | "" = "indexed") {
    const q = encodeURIComponent("filename:slopscore.md path:/");
    return this.get<{ total_count: number; incomplete_results: boolean; items: GhCodeSearchItem[] }>(`/search/code?q=${q}&per_page=100&page=${page}${sort ? `&sort=${sort}&order=desc` : ""}`);
  }
  /** Render markdown through GitHub's sanitiser, resolving relative links against the repo. */
  async renderMarkdown(text: string, context: string): Promise<string | null> {
    const r = await this.post<string>("/markdown", { text, mode: "gfm", context }, { accept: "text/html", raw: true });
    return r.status === 200 ? r.data : null;
  }

  /** Raw file from the default branch. No token needed, no API rate limit. */
  async rawFile(owner: string, name: string, branch: string, path: string, maxBytes = 200_000): Promise<{ status: number; text: string | null }> {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`, { headers: { "user-agent": UA } });
    if (res.status !== 200) return { status: res.status, text: null };
    const text = await res.text();
    return { status: 200, text: text.length > maxBytes ? text.slice(0, maxBytes) : text };
  }

  async rawBytes(owner: string, name: string, branch: string, path: string, maxBytes = 3_000_000): Promise<Uint8Array | null> {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`, { headers: { "user-agent": UA } });
    if (res.status !== 200) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  static async userFromToken(token: string): Promise<GhUser | null> {
    const res = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token}`, "user-agent": UA, accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as GhUser;
  }

  static async exchangeCode(clientId: string, clientSecret: string, code: string): Promise<string | null> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  }
}

export function parseGhDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** Owner/name from a redirect Location like https://api.github.com/repositories/123 or /repos/o/r. */
export function fullNameFromRedirect(location: string | undefined): string | null {
  if (!location) return null;
  const m = /\/repos\/([^/]+)\/([^/?#]+)/.exec(location);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Accepts `owner/name`, `github.com/owner/name`, a full GitHub URL (with or without .git, a trailing path, or a branch), and returns [owner, name] or null. */
export function parseRepoInput(input: string): [string, string] | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/^git@github\.com:/i, "");
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(s);
  if (!m) return null;
  const name = m[2];
  if (name === "." || name === "..") return null;
  return [m[1], name];
}
