// Minimal GitHub client. ETag-aware, rate-limit-aware. Phase 3 grows this; phase 1 needs OAuth + a quick repo fetch.

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

export type GhResult<T> =
  | { status: 200; data: T; etag: string | null }
  | { status: 304; data: null; etag: string | null }
  | { status: number; data: null; etag: null; error: string; blocked?: boolean; redirect?: string };

const UA = "slopscore (+https://slopscore.dev)";

export class GitHub {
  constructor(private token?: string) {}

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

  async get<T>(path: string, opts: { etag?: string | null; accept?: string; raw?: boolean } = {}): Promise<GhResult<T>> {
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const extra: Record<string, string> = {};
    if (opts.etag) extra["if-none-match"] = opts.etag;
    if (opts.accept) extra.accept = opts.accept;
    const res = await fetch(url, { headers: this.headers(extra), redirect: "manual" });
    const etag = res.headers.get("etag");
    if (res.status === 304) return { status: 304, data: null, etag };
    if (res.status === 200) {
      const data = (opts.raw ? await res.text() : await res.json()) as T;
      return { status: 200, data, etag };
    }
    if (res.status === 301 || res.status === 302 || res.status === 307) {
      return { status: res.status, data: null, etag: null, error: "redirect", redirect: res.headers.get("location") ?? undefined };
    }
    let error = res.statusText;
    let blocked = false;
    try {
      const body = (await res.json()) as { message?: string; block?: unknown };
      error = body.message ?? error;
      blocked = Boolean(body.block) || /access blocked|repository access blocked/i.test(error);
    } catch { /* ignore */ }
    return { status: res.status, data: null, etag: null, error, blocked };
  }

  repo(owner: string, name: string, etag?: string | null) {
    return this.get<GhRepo>(`/repos/${owner}/${name}`, { etag });
  }

  /** Raw slopscore.md from the default branch. No token needed, no API rate limit. */
  async rawFile(owner: string, name: string, branch: string, path: string): Promise<{ status: number; text: string | null }> {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`, {
      headers: { "user-agent": UA },
      cf: { cacheTtl: 60, cacheEverything: false },
    } as RequestInit);
    if (res.status !== 200) return { status: res.status, text: null };
    const text = await res.text();
    return { status: 200, text: text.length > 200_000 ? text.slice(0, 200_000) : text };
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
