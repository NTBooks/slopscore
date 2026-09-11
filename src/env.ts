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
  VIEW_SAMPLE?: string;
  FRESHNESS?: string;
  ANON_PER_ID_DAY?: string;
  ANON_PER_IP_DAY?: string;
  ANON_NEW_IDS_PER_IP?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_CRAWL_TOKEN?: string;
  SESSION_SECRET: string;
  SAFE_BROWSING_KEY?: string;
  /** Paid scans route their AI checks here instead of Workers AI, so they never touch the free neuron budget. */
  OPENROUTER_API_KEY?: string;
  OPENROUTER_GUARD_MODEL?: string;
  OPENROUTER_VISION_MODEL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DONATE_USD?: string;
  X402_PAY_TO?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR?: string;
  RUSH_PRICE_USD?: string;
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
