// Payments: Stripe Checkout for humans (owner donates $5, repo jumps the line) and x402 for agents.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { getRepo, rateLimit } from "../lib/db";
import { requireUser, wantsJson } from "../middleware";
import { isOwnerOf } from "../lib/owner";
import { rushRepo, immediateMode } from "../lib/rush";

export const pay = new Hono<AppEnv>();

// ---------------- Stripe ----------------
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

pay.post("/r/:owner/:name/donate", requireUser, async (c) => {
  const user = c.get("user")!;
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: "payments are not configured" }, 503);
  const repo = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!repo) return c.json({ error: "unknown repo" }, 404);
  if (!isOwnerOf(repo, user.login, user.id)) return c.json({ error: "only the owner (or a maintainer) can jump the line for a repo" }, 403);
  if (!["discovered", "rejected", "listed"].includes(repo.status)) return c.json({ error: `nothing to rush in status ${repo.status}` }, 409);
  const usd = Math.max(1, Number(c.env.DONATE_USD || 5));
  const origin = new URL(c.req.url).origin;
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(usd * 100)),
      "line_items[0][price_data][product_data][name]": `SlopScore: jump the line for ${repo.full_name}`,
      "line_items[0][price_data][product_data][description]": "Covers the hosting bill. Buys the wait, never a gate, a vote, or an award.",
      client_reference_id: String(repo.id),
      "metadata[repo_id]": String(repo.id),
      "metadata[user_id]": String(user.id),
      "metadata[login]": user.login,
      success_url: `${origin}/r/${repo.full_name}?donated=1`,
      cancel_url: `${origin}/r/${repo.full_name}`,
    }),
  });
  if (!res.ok) return c.json({ error: `Stripe error ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
  const session = (await res.json()) as { id: string; url: string };
  return wantsJson(c) ? c.json({ ok: true, url: session.url, session: session.id }) : c.redirect(session.url, 303);
});

/** Stripe webhook: verify the signature ourselves (HMAC-SHA256 over "t.payload"), then rush the repo. Idempotent on session id. */
pay.post("/webhooks/stripe", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: "webhook not configured" }, 503);
  const payload = await c.req.text();
  const sig = c.req.header("stripe-signature") ?? "";
  const parts = Object.fromEntries(sig.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts.t; const v1 = sig.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  if (!t || !v1.length) return c.json({ error: "bad signature header" }, 400);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return c.json({ error: "stale timestamp" }, 400);
  const expected = await hmacHex(c.env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  if (!v1.some((v) => timingSafeEqual(v, expected))) return c.json({ error: "signature mismatch" }, 400);

  const event = JSON.parse(payload) as { id: string; type: string; data: { object: { id: string; amount_total?: number; currency?: string; client_reference_id?: string; metadata?: Record<string, string>; payment_status?: string } } };
  if (event.type !== "checkout.session.completed") return c.json({ received: true, ignored: event.type });
  const s = event.data.object;
  if (s.payment_status && s.payment_status !== "paid") return c.json({ received: true, ignored: s.payment_status });
  const repoId = Number(s.metadata?.repo_id ?? s.client_reference_id ?? 0);
  if (!repoId) return c.json({ received: true, ignored: "no repo" });
  const r = await rushRepo(c.env, {
    provider: "stripe", externalId: s.id, repoId, userId: s.metadata?.user_id ? Number(s.metadata.user_id) : null,
    payer: s.metadata?.login ?? "someone", amountCents: s.amount_total ?? Math.round(Number(c.env.DONATE_USD || 5) * 100), currency: s.currency ?? "usd",
  }, c.executionCtx);
  return c.json({ received: true, ...r });
});

// ---------------- x402 ----------------
const USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

function requirements(c: { env: AppEnv["Bindings"]; req: { url: string } }, fullName: string) {
  const usd = Math.max(0.01, Number(c.env.RUSH_PRICE_USD || 0.25));
  const network = c.env.X402_NETWORK || "base-sepolia";
  return {
    scheme: "exact",
    network,
    maxAmountRequired: String(Math.round(usd * 1_000_000)),   // USDC has 6 decimals
    resource: `${new URL(c.req.url).origin}/r/${fullName}/rush`,
    description: `SlopScore: jump the scan queue for ${fullName}. Buys the wait, never a gate. ${immediateMode(c.env) ? "Scans immediately." : "Front of the line for the next scan window."}`,
    mimeType: "application/json",
    payTo: c.env.X402_PAY_TO,
    maxTimeoutSeconds: 120,
    asset: USDC[network] ?? USDC["base-sepolia"],
    extra: { name: network === "base" ? "USD Coin" : "USDC", version: "2" },
  };
}

async function rushHandler(c: Context<AppEnv>) {
  const repo = await getRepo(c.env.DB, c.req.param("owner") ?? "", c.req.param("name") ?? "");
  if (!repo) return c.json({ error: "unknown repo; commit a slopscore.md and GET /ping/:owner/:repo first" }, 404);
  if (!c.env.X402_PAY_TO) return c.json({ error: "x402 is not enabled on this site yet", alternative: "log in as the owner and use the $5 Stripe jump on the repo page" }, 503);
  if (!(await rateLimit(c.env.DB, `rush:${repo.id}`, 1, 600))) return c.json({ error: "rushed in the last 10 minutes" }, 429);
  const req = requirements(c, repo.full_name);
  const header = c.req.header("x-payment");
  if (!header) {
    return c.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [req] }, 402);
  }
  let paymentPayload: unknown;
  try { paymentPayload = JSON.parse(atob(header)); } catch { return c.json({ x402Version: 1, error: "malformed X-PAYMENT", accepts: [req] }, 402); }
  const facilitator = (c.env.X402_FACILITATOR || "https://x402.org/facilitator").replace(/\/$/, "");
  const verify = await fetch(`${facilitator}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: req }) });
  const vj = (await verify.json().catch(() => ({}))) as { isValid?: boolean; invalidReason?: string; payer?: string };
  if (!verify.ok || !vj.isValid) return c.json({ x402Version: 1, error: `payment invalid: ${vj.invalidReason ?? verify.status}`, accepts: [req] }, 402);
  const settle = await fetch(`${facilitator}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: req }) });
  const sj = (await settle.json().catch(() => ({}))) as { success?: boolean; transaction?: string; errorReason?: string; payer?: string };
  if (!settle.ok || !sj.success) return c.json({ x402Version: 1, error: `settlement failed: ${sj.errorReason ?? settle.status}`, accepts: [req] }, 402);
  const payer = (sj.payer ?? vj.payer ?? "0x?").replace(/^(0x[0-9a-fA-F]{4})[0-9a-fA-F]+([0-9a-fA-F]{4})$/, "$1…$2");
  const r = await rushRepo(c.env, { provider: "x402", externalId: sj.transaction ?? `x402:${Date.now()}`, repoId: repo.id, userId: null, payer, amountCents: Math.round(Number(req.maxAmountRequired) / 10_000), currency: "usdc" }, c.executionCtx);
  c.header("X-PAYMENT-RESPONSE", btoa(JSON.stringify({ success: true, transaction: sj.transaction, network: req.network })));
  return c.json({ ...r, url: `/r/${repo.full_name}` });
}
pay.post("/r/:owner/:name/rush", rushHandler);
pay.get("/r/:owner/:name/rush", rushHandler);

// ---------------- helpers ----------------
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
export { hmacHex, timingSafeEqual };
