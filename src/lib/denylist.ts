// Gate 0: denylist + link rules. No API, no AI. Runs first so bad repos never spend neurons.
import profanityTxt from "./denylist/profanity-en.txt";
import spamTxt from "./denylist/spam.txt";
import domainsTxt from "./denylist/domains.txt";

const lines = (t: string) => t.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith("#"));

export const PROFANITY = new Set(lines(profanityTxt));
export const SPAM_PHRASES = lines(spamTxt);
export const BAD_DOMAINS = new Set(lines(domainsTxt));

export interface DenyRow { term: string; kind: "slur" | "spam" | "domain"; scope: "title" | "any" }

export interface DenyResult {
  /** Terms that reject (admin `slur` terms in short fields, bad-domain links, executables, shorteners, IP-literal links). */
  reject: string[];
  /** Terms that only flag (+risk): profanity/spam phrases anywhere, invites, crypto bait. */
  flags: string[];
  links: string[];
}

const EXEC_EXT = /\.(exe|msi|dmg|pkg|apk|ipa|zip|7z|rar|scr|bat|cmd|ps1|jar)(\?|#|$)/i;
const URL_RE = /https?:\/\/[^\s<>)"'\]]+/gi;
const IP_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;
const INVITE_RE = /(discord\.gg\/|discord\.com\/invite\/|t\.me\/|telegram\.me\/)/i;
const CRYPTO_BAIT = /(airdrop|free\s+(eth|btc|sol|usdt|usdc)|double\s+your|guaranteed\s+(returns|profit))/i;
const INVISIBLE = new RegExp(`[${String.fromCodePoint(0x200b)}-${String.fromCodePoint(0x200f)}${String.fromCodePoint(0x2028)}-${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x2060)}-${String.fromCodePoint(0x206f)}${String.fromCodePoint(0xfeff)}]`);

export function extractLinks(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}

function wordHit(haystack: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * short: title, tagline, tags, category values, owner login (joined). long: body + README text.
 * dbRows: admin-added terms from the denylist table.
 */
export function denylistGate(short: string, long: string, dbRows: DenyRow[] = []): DenyResult {
  const reject: string[] = [];
  const flags: string[] = [];
  const s = short.toLowerCase();
  const l = long.toLowerCase();

  for (const row of dbRows) {
    if (row.kind === "domain") continue;
    if (row.kind === "slur") {
      if (wordHit(s, row.term)) reject.push(`prohibited term in title/tags`);
      else if (wordHit(l, row.term)) flags.push(`prohibited term in body`);
    } else if (wordHit(s, row.term) || wordHit(l, row.term)) flags.push(`spam term "${row.term}"`);
  }
  for (const phrase of SPAM_PHRASES) if (wordHit(s, phrase) || wordHit(l, phrase)) flags.push(`spam phrase "${phrase}"`);
  // profanity only ever flags, and only once, so a salty README isn't a wall of flags
  const shortWords = s.split(/[^a-z0-9'-]+/);
  const longWords = l.split(/[^a-z0-9'-]+/);
  if (shortWords.some((w) => PROFANITY.has(w))) flags.push("profanity in title/tags");
  else if (longWords.some((w) => PROFANITY.has(w))) flags.push("profanity in body/README");

  const links = extractLinks(`${short}\n${long}`);
  const dbDomains = new Set(dbRows.filter((r) => r.kind === "domain").map((r) => r.term));
  for (const link of links) {
    let host = "";
    try { host = new URL(link).hostname.toLowerCase(); } catch { continue; }
    const bare = host.replace(/^www\./, "");
    if (BAD_DOMAINS.has(bare) || dbDomains.has(bare)) reject.push(`link to ${bare}`);
    else if (IP_HOST.test(host)) reject.push(`link to a bare IP address (${host})`);
    else if (EXEC_EXT.test(link)) reject.push(`link to an executable or archive (${link.split("/").pop()?.slice(0, 40)})`);
    if (INVITE_RE.test(link)) flags.push("chat invite link");
  }
  if (links.length > 30) reject.push(`${links.length} links (max 30)`);
  if (CRYPTO_BAIT.test(`${short} ${long}`)) flags.push("crypto bait phrasing");
  if (INVISIBLE.test(short)) flags.push("invisible unicode in title");
  if (/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(short) && /[a-z]/i.test(short)) flags.push("mixed-script title");

  return { reject: [...new Set(reject)], flags: [...new Set(flags)], links };
}

export async function loadDenyRows(db: D1Database): Promise<DenyRow[]> {
  const r = await db.prepare("SELECT term, kind, scope FROM denylist").all<DenyRow>();
  return r.results ?? [];
}
