export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_URL?: string;
  PLAN_MODE?: string; // free | paid
  ADMIN_LOGINS: string;
  MIN_ACCOUNT_AGE_DAYS: string;
  AUTO_HIDE_REPORTS: string;
  AI_NEURON_BUDGET: string;
  RISK_QUARANTINE: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_CRAWL_TOKEN?: string;
  SESSION_SECRET: string;
  SAFE_BROWSING_KEY?: string;
}

export interface SessionUser {
  id: number;
  login: string;
  avatar_url: string | null;
  gh_created_at: number | null;
  public_repos: number;
  banned_at: number | null;
  isAdmin: boolean;
  canWrite: boolean;
  csrf: string;
  row: import("./lib/db").UserRow;
}

export type Vars = {
  user: SessionUser | null;
  format: "html" | "json" | "md";
};

export type AppEnv = { Bindings: Env; Variables: Vars };

export function adminLogins(env: Env): Set<string> {
  return new Set((env.ADMIN_LOGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}
