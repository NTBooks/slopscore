// The lookout: read the crew's own heartbeats once a tick, and say something when one of them has stopped.
//
// This is the other half of noteRun (lib/crawlclock.ts). The heartbeat makes a stall visible to anyone who
// opens /queue; the lookout is for the hours when nobody does. At most one mail a UTC day, whatever is
// wrong -- an alarm that can fire every tick is a mail bomb pointed at its owner, and the thing it is
// reporting is by definition already broken, so a second copy helps nobody.
//
// It fails open in every direction. No MAIL binding, no destination, a send that throws, a claim that loses
// the race: all of them leave the site running and the heartbeat rows intact. A lookout that can take the
// ship down is worse than no lookout.
//
// It deliberately says nothing about a job whose health is "never". A feature that shipped after the last
// tick has simply not had its turn, and mailing about that trains the owner to ignore the mail.
import type { Env } from "../env";
import { crawlClock, HEALTH_LABEL, type JobClock } from "../lib/crawlclock";
import { ago, isoDate, isoDateTime, now } from "../lib/time";

export interface LookoutResult { ailing: string[]; mailed: boolean; note?: string }

export async function lookout(env: Env): Promise<LookoutResult> {
  const clock = await crawlClock(env.DB);
  if (!clock.ailing.length) return { ailing: [], mailed: false };
  const names = clock.ailing.map((j) => j.job);
  // CONTACT_NOTIFY rather than a var of its own: it is the same owner's inbox, already verified as an Email
  // Routing destination, and one address to rotate is better than two to forget.
  const to = env.CONTACT_NOTIFY;
  if (!env.MAIL || !to) return { ailing: names, mailed: false, note: "no MAIL binding or CONTACT_NOTIFY; the heartbeat is still on /queue" };
  // The claim is the throttle. An atomic insert, so two ticks in the same second cannot both win the day.
  const claimed = await env.DB.prepare(
    "INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  ).bind(`lookout:alerted:${isoDate(now())}`, String(now())).run().catch(() => null);
  if (!claimed || !claimed.meta.changes) return { ailing: names, mailed: false, note: "already mailed today" };
  const sent = await send(env, to, clock.ailing, clock.now).then(() => true).catch(() => false);
  return { ailing: names, mailed: sent, note: sent ? undefined : "send failed; /queue still shows it" };
}

function line(j: JobClock, at: number): string[] {
  return [
    `  ${j.job}`,
    `    state:    ${HEALTH_LABEL[j.health]}`,
    `    last ok:  ${j.last_ok ? `${isoDateTime(j.last_ok)} (${ago(j.last_ok, at)})` : "never"}`,
    ...(j.last_fail ? [`    failed:   ${ago(j.last_fail.at, at)} -- ${j.last_fail.why || "no message"}`] : []),
    `    does:     ${j.does}`,
  ];
}

async function send(env: Env, to: string, ailing: JobClock[], at: number): Promise<void> {
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const site = env.SITE_URL ?? "https://slopscore.org";
  const failing = ailing.filter((j) => j.health === "failing");
  const lines = [
    `${ailing.length === 1 ? "A crew member has" : `${ailing.length} crew members have`} stopped reporting in.`,
    "",
    ...ailing.flatMap((j) => [...line(j, at), ""]),
    failing.length
      ? "A job marked failing threw and said why. A job marked overdue did not throw at all -- it stopped"
      : "A job marked overdue did not throw -- it stopped",
    "finishing, which is what a killed or hung invocation looks like from outside. Neither state is",
    "reached by a job that has simply never had its turn yet.",
    "",
    `The full clock, with next fire times: ${site}/queue`,
    "",
    "One mail a day at most, however many jobs are unhappy. Nothing here is lost work: every job is",
    "idempotent and the next tick retries on its own. This is the doorbell, not the repair.",
  ];
  const subject = `[SlopScore] ${ailing.length} job${ailing.length === 1 ? "" : "s"} not reporting in (${ailing.map((j) => j.job).join(", ")})`;
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]/g, " ").slice(0, 200)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <lookout-${isoDate(at)}-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    lines.join("\n"),
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL!.send(new EmailMessage(from, to, raw));
}
