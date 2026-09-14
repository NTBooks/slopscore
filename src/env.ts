export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_URL?: string;
  /** The one hostname every absolute URL we emit uses. Other domains we answer on are spoken about as this one (src/lib/host.ts). */
  PRIMARY_HOST?: string;
  /** "on" puts trawled listings in search and the sitemap; anything else keeps them readable but unindexed (src/lib/virtual.ts). */
  TRAWL_INDEX?: string;
  /** "on" also indexes /u/{login} for owners who never opted in. Separate from TRAWL_INDEX and off by default: a handle is a person. */
  TRAWL_OWNER_INDEX?: string;
  PLAN_MODE?: string; // free | paid
  ADMIN_LOGINS: string;
  MIN_ACCOUNT_AGE_DAYS: string;
  AUTO_HIDE_REPORTS: string;
  AI_NEURON_BUDGET: string;
  RISK_QUARANTINE: string;
  /** Moderation flags, comma list of what's ON (see lib/flags.ts). Empty = all. */
  MOD_FLAGS?: string;
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
  /** The daily trawl's judge: classifies a candidate before it is listed (src/lib/judge.ts). */
  OPENROUTER_JUDGE_MODEL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DONATE_USD?: string;
  X402_PAY_TO?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR?: string;
  RUSH_PRICE_USD?: string;
  /** Contact: public aliases (Email Routing) and an optional notification path via the send-email binding. */
  CONTACT_EMAIL?: string;
  ABUSE_EMAIL?: string;
  CONTACT_NOTIFY?: string;   // secret: a verified Email Routing destination (your real inbox); never rendered
  CONTACT_FROM?: string;
  MAIL?: { send(message: unknown): Promise<void> };
  /** Tripwire (lib/tripwire.ts). NOTIFY is a secret and falls back to CONTACT_NOTIFY; never rendered. */
  TRIPWIRE_NOTIFY?: string;
  /** Targeted probes in one UTC day before the email goes out. Default 1. One email a day regardless. */
  TRIPWIRE_ALERT_AT?: string;
  /** The model the disclosed critics read with, through OpenRouter. Critics are site accounts, never GitHub accounts (src/lib/critics.ts). */
  CRITICS_MODEL?: string;
  /** Truffle trawl: repos listed per day, and the opted-in listing count at which the trawl stops for good. */
  TRAWL_PER_DAY?: string;
  TRAWL_STOP_AT?: string;
  /** Takedowns of trawled listings that delist automatically per day, site-wide; beyond it they queue for a human. */
  TAKEDOWN_AUTO_PER_DAY?: string;
  /** IndexNow key (public by design; served at /{key}.txt). Unset = no engine pings. See src/lib/indexnow.ts. */
  INDEXNOW_KEY?: string;
  /**
   * Where the weekly bulletin is mailed from — a newsletter we do not run.
   *
   * Public, rendered on /report as a subscribe link, and deliberately not a mailing list of our own: a list
   * means storing strangers' email addresses, and this site stores nothing it does not own. Substack today;
   * the name is generic because moving is a config change, not a migration. Unset = no subscribe link
   * anywhere, and the bulletin is still published, still on RSS, still readable.
   */
  NEWSLETTER_URL?: string;
  /** What to call it in the subscribe line. Defaults to the host of NEWSLETTER_URL. */
  NEWSLETTER_NAME?: string;
}

export interface SessionUser {
  id: number;
  login: string;
  avatar_url: string | null;
  gh_created_at: number | null;
  public_repos: number;
  banned_at: number | null;
  isAdmin: boolean;
  isCritic: boolean;
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
