// Stateless signed sessions: base64url(payload).base64url(hmac-sha256). Cookie for browsers, Bearer for agents.
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export interface SessionPayload { uid: number; exp: number; kind?: "web" | "device" }

const COOKIE = "ss";
const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verify(token: string, secret: string): Promise<SessionPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload;
    if (typeof p.uid !== "number" || typeof p.exp !== "number") return null;
    if (p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export const THIRTY_DAYS = 30 * 24 * 3600;

export async function issueWebSession(c: Context, uid: number, secret: string) {
  const token = await sign({ uid, exp: Math.floor(Date.now() / 1000) + THIRTY_DAYS, kind: "web" }, secret);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export function clearWebSession(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Reads a session from the Bearer header (agents) or cookie (browsers). */
export async function readSession(c: Context, secret: string): Promise<SessionPayload | null> {
  const auth = c.req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return verify(auth.slice(7).trim(), secret);
  }
  const cookie = getCookie(c, COOKIE);
  return cookie ? verify(cookie, secret) : null;
}

/** CSRF token for HTML forms: HMAC of uid + "csrf". Bearer requests are exempt. */
export async function csrfToken(uid: number, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`csrf:${uid}`));
  return b64url(sig).slice(0, 32);
}
