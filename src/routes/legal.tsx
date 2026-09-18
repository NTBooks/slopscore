// The two legal pages: /privacy and /terms. Prose in the /manifesto shape (a markdown string, three formats,
// no database), and every sentence in them is a claim about this codebase, so when the code changes the page
// has to. The things the privacy page promises, and where each one is enforced:
//
//   no raw IP in the database      ipHash() in lib/trust.ts is the only way an address reaches a row; the
//                                  callers are middleware.ts (tripwire), pages.tsx (votes, ping), takedown.tsx
//   three first-party cookies      ss (lib/session.ts), oauth_state (routes/auth.ts), anon (lib/anon.ts)
//   GitHub token discarded         routes/auth.ts reads /user and never stores the token
//   no email stored                upsertUser() in lib/db.ts binds six fields; email is not one of them
//   view buckets pruned at 35 days pruneViews() in lib/views.ts
//   tripwire rows gone at 14 days  sweepTripwire() in lib/tripwire.ts
//   takedown deletes after 3 days  TAKEDOWN_GRACE in lib/virtual.ts
//   analytics is cookieless        Cloudflare Web Analytics, admitted by lib/csp.ts and nothing else
//
// Still to do before the site can call itself finished, each marked in place with todo() below so the note sits on
// the exact line it changes and renders as nothing:
//   1. name the controller: a legal name and country in the privacy intro (GDPR Art. 13), and a governing-law
//      section at the end of the terms;
//   2. register a DMCA agent with the US Copyright Office and put the agent line under "Copyright and takedowns";
//   3. a self-serve delete on /me (routes/pages.tsx), so the "Delete it" promise is code rather than a chore.
//
// The date in the heading is the last time the words changed. The page is versioned in the public repo, and
// the git history is the changelog the page points readers at, so there is no separate "previous versions" list.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";

export const legal = new Hono<AppEnv>();

export const LEGAL_UPDATED = "18 September 2026";
/** A note on the line it belongs to, rendering as nothing. Grep for todo( to find what is still open. */
const todo = (_note: string) => "";
const SOURCE = "https://github.com/NTBooks/slopscore";

const privacyMd = (origin: string, contact: string, abuse: string) => `# Privacy

*Last changed ${LEGAL_UPDATED}. This page lives in the [public source](${SOURCE}); the git history is the changelog.*

${todo("TODO name the controller: legal name and country, GDPR Art. 13; then rewrite the sentence that follows")}SlopScore is run by one person, not a company. Anything on this page, and every request it describes, goes to [${contact}](mailto:${contact}) or the [contact form](${origin}/contact). Legal notices go to [${abuse}](mailto:${abuse}).

**The short version.** Log in with GitHub and we keep your GitHub id, login and avatar. We never see your password, your email or your code. No raw IP address is ever written to our database. There is no ad network, no tracking pixel and no cookie banner, because nothing here needs consent: every cookie is set only when you do the thing it exists for.

## What we collect, and why

### From everyone who visits

- **Server logs.** The site runs on Cloudflare Workers. Cloudflare sees every request (address, user agent, URL) in order to deliver it and to stop attacks, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). The site itself writes no request log.
- **Analytics.** Cloudflare Web Analytics counts page views. It sets no cookie and does no fingerprinting. We see aggregate counts, not people.
- **View counts.** Each listing counts its page views per hour, with no record of who viewed it. The buckets are deleted after 35 days. They exist so a burst of votes can be compared against traffic.
- **Hashed addresses.** For vote-ring detection, takedown rate limits and attack detection, the site keeps a keyed SHA-256 hash of your IP address, truncated to eight bytes, and never the address itself. Attack counters, and the 24-hour blocks they produce, are deleted after 14 days. The hash on a vote stays with the vote.
- **Cookies.** Three, all set by this site, all \`HttpOnly\`, none readable by anyone else: \`ss\` (your login session, 30 days), \`oauth_state\` (ten minutes, only during the GitHub handshake), and \`anon\` (a random id, set only if you vote without logging in, one year). No third-party cookies.

### If you log in

Login is GitHub OAuth with the \`read:user\` scope. GitHub sends us your public profile, and we keep your numeric id, login, avatar URL, account creation date, public repo count and follower count. The last three set your vote weight. We record when you first and last logged in. The GitHub access token is discarded the moment your profile has been read: we do not keep it and cannot act as you on GitHub. We do not store your email address, even when GitHub includes a public one.

After that, what you do here is kept with your login:

- **Votes** on repos and on comments, with their weight and the hashed address above.
- **Comments**, which are public, in the markdown you typed and the HTML it rendered to. Each is checked by a moderation model before it appears, and that result is stored with it. Deleting a comment removes its text from the site; the row stays so the thread keeps its shape.
- **Reports**: which item, the reason, and your note. Reports are seen only by moderators.
- **Contact messages**: subject, body and repo. If you type an email address into the body so we can reply there, it is stored with the message.
- **Submissions, removals and takedowns** of your own repos, and the [moderation log](${origin}/log), which is public and names the login that acted.
- **Payments.** If you pay to jump the scan queue, Stripe handles the card and we keep the Stripe session id, the amount, your login and the repo. Card details never reach this site. A crypto payment (x402) is recorded by its transaction id.
- **Agent tokens.** An agent that logs in by device flow gets a signed token good for 90 days. The site stores nothing about the token; it is checked by signature.

A ban records the login, the time and the reason.

### If you own a repo we list

Most of what this site holds is about repositories, and a repository has an owner. For every listing the site copies public data from the GitHub API: the repo's metadata, README and \`slopscore.md\`, and the owner's login, avatar and account type. It keeps earlier versions of the marker file. Stars, language and license are refreshed on each recrawl.

You did not necessarily opt in. Some listings are **trawled**: public repos whose owners said in public that a model wrote them, under a permissive license. We list them as commentary on public data, the way every mirror and aggregator does, under our legitimate interest in running a public index of AI-made software. You can object, and objecting works: press **request a takedown** on the listing, no login needed. The listing is hidden at once and deleted for good three days later. For a repo that opted in, delete its \`slopscore.md\` or press Remove on its page after logging in. A profile page for someone who never opted in is kept out of search engines.

## Models that read your data

No person reads your comment before it appears; a model does. Where the text goes:

- **Cloudflare Workers AI** runs Llama Guard over comments and repo text for prohibited content, and a vision model over listing thumbnails. This stays on Cloudflare's infrastructure.
- **OpenRouter** carries two jobs to a model named in the [public source](${SOURCE}): the classifier that sorts trawled repos, and the critics that vote here. It sees repo text, never your account or your comments. [OpenRouter's privacy policy](https://openrouter.ai/privacy).
- **Google Safe Browsing** is asked whether a link in a repo is known malware or phishing. It sees the URL and nothing about you.

Each is sent the minimum the check needs, and none of them receives your login.

## Who else sees it

- **Cloudflare**: hosting, database, Workers AI, email routing and analytics.
- **GitHub**: identity, and the source of every listing. Avatars and README images load from GitHub's own servers, so GitHub sees those requests. [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Stripe**: payments. [Stripe's privacy policy](https://stripe.com/privacy).
- **Substack**: the weekly report is mailed from a Substack publication. Subscribing there is between you and Substack; this site keeps no mailing list and never sees a reader's address.

We do not sell personal data, and no advertiser or data broker receives anything. Everything else about you here is public on purpose: your votes are counted, your comments are shown, and your login appears in the moderation log when a moderator acts on your account or your repo.

## Where it lives

Cloudflare runs a global network, so your data may be stored and processed in the United States and elsewhere. If you are in the EU, the UK or Switzerland, those transfers rest on the standard contractual clauses and data processing terms of Cloudflare, GitHub and Stripe.

## How long

- Your account, votes, comments, reports and messages: until you ask us to delete them, or the site shuts down.
- Listing data: until the repo is delisted. A takedown deletes it three days after the request.
- View buckets: 35 days. Attack counters and blocks: 14 days.
- Payment records: as long as tax law requires.

## Your rights

Wherever you are, you can ask for any of these. Where the GDPR, the UK GDPR or a similar law applies to you, they are rights, and we answer within a month.

- **See it.** Every page here is also \`.json\`, [/me](${origin}/me) lists your repos, and the moderation log is public. Ask, and we send everything held against your login.
- **Fix it.** Your profile fields come from GitHub; log in again and they refresh.
${todo("TODO self-serve delete on /me (routes/pages.tsx); until then this is done by hand in D1 within a month")}- **Delete it.** Ask through the [contact form](${origin}/contact) or by email, from the GitHub account in question. We delete your user record, votes, reports and messages, remove your comments, and confirm when it is done. Records tax law requires us to keep stay.
- **Object.** The takedown link on a trawled listing is the objection, and it is honoured before anyone reads it.
- **Take it with you.** \`.json\` on any page, or ask for an export.
- **Complain.** In the EU, to your national data protection authority; in the UK, to the ICO. We would rather hear it first.

No decision with a legal effect on you is made automatically. Listing, rejection and holds are model-assisted, every held item is reviewed by a human moderator, and a human can be reached through the contact form.

## Children

You must be at least 13 to have a GitHub account, and so to log in here. We do not knowingly keep data on anyone younger. If you think we do, tell us and it goes.

## Changes

This page is versioned in the open. A substantive change gets a note on the site, and the commit history holds every word that changed. Terms of use are on [their own page](${origin}/terms).
`;

const termsMd = (origin: string, contact: string, abuse: string) => `# Terms of use

*Last changed ${LEGAL_UPDATED}. This page lives in the [public source](${SOURCE}); the git history is the changelog.*

These are the rules for using SlopScore. They are short because the site is small. Using the site means you accept them. Nothing here is required for anything, so if you do not accept them, the answer is to not use it. How we handle your data is on the [privacy page](${origin}/privacy), which is part of these terms.

## What SlopScore is

A public leaderboard and directory of AI-generated software, and the labels and writing around it. Listings are built from public GitHub data and from a self-reported \`slopscore.md\`. Scores, awards, scan reports, classifier labels and critic sentences are **opinions**, produced by votes and by software under a [published method](${origin}/method), and not statements of fact about you or your code. Nothing here is professional advice of any kind.

## Who can use it

Reading needs nothing. Writing (voting, commenting, submitting, reporting) needs a GitHub account, so you must be old enough for one (13) and you must not be banned here. An agent may act for you through the documented device flow; what it does is your doing.

## Your account

One person, one GitHub account. Do not use anyone else's session or token. If GitHub suspends your account, you are suspended here too.

## Your content

You keep what you write. By posting a comment, submitting a \`slopscore.md\`, or sending a takedown or contact message, you give us a non-exclusive, worldwide, royalty-free licence to store it, show it, convert it between formats (HTML, JSON, Markdown, RSS), quote it in public logs, reports and moderation, and cache it. A comment you delete comes off the site; what already appeared in a public log stays there.

You are responsible for what you post. Do not post:

- harassment, hate, threats, or anyone's private information;
- sexual content or gore;
- spam, vote trading, or referral schemes;
- malware, phishing, or links to either;
- anything illegal where you are or where the site is run.

Repos containing these are rejected under the [content rules](${origin}/spec), whatever their disclosure says.

## Listings

A listing is commentary on a public repository. We show its metadata, README and marker file as GitHub serves them, under the repo's own license and GitHub's terms. **Trawled** listings are public repos whose owners said in public that a model wrote them, under a permissive license; they are marked as such and rank below every repo that opted in. Any owner can remove a listing: press Remove after logging in, delete the marker file, or use the takedown link, which needs no account and takes effect at once. We may list, hold, reject, hide or delist anything at any time, with the reason published in the [queue](${origin}/queue) and the [mod log](${origin}/log).

## Votes

Vote as yourself, once per item. No rings, no bought votes, no sockpuppets, and no bots beyond the disclosed critics. Votes are weighted and fuzzed. A vote we judge manipulated counts for nothing, and the account behind it may be banned. The critics that vote here are disclosed on [about](${origin}/about).

## Agents and the API

The API, the feeds and the MCP server are free to use within the published rate limits. Read the digest instead of crawling. Any of it can change or go away without notice. Requests shaped like an attack close the door on their source for a day.

## Paying to jump the queue

A rush payment buys a place at the front of the scan queue and nothing else: not a listing, not a score, not an award. It is a contribution toward hosting, in the amount shown at checkout, processed by Stripe under Stripe's terms. A crypto payment (x402) is final on chain. Once the scan has run, the payment did what it said and is not refundable. If the scan does not run within a reasonable time, write to us and we refund it.

## Copyright and takedowns

${todo("TODO register a DMCA agent with the US Copyright Office (copyright.gov/dmca-directory) and name the agent here")}If you believe something here infringes your copyright, send a notice to [${abuse}](mailto:${abuse}) with: the work, the URL here, your contact details, a statement of good-faith belief that the use is not authorised, a statement under penalty of perjury that you are the owner or act for them, and your signature. We remove or disable what the notice identifies and tell the poster, who may send a counter-notice. Repeat infringers are banned. If you only want your own repo off the site, the takedown link is faster than a lawyer.

## Moderation

We can remove content and ban accounts for breaking these rules, for gaming votes, or to protect the site or the people on it. Moderation actions are logged in public with a reason. Appeals go through the [contact form](${origin}/contact).

## No warranty

The site is provided as is and as available, with no warranty of any kind: not that it is accurate, complete, available, secure, or fit for any purpose. Scores and reports are opinions built from a stated method with [stated biases](${origin}/method).

## Limitation of liability

To the fullest extent the law allows, the operator is not liable for any indirect, incidental, special or consequential damage, or for lost profits, data or goodwill, arising from your use of the site or from any listing, vote, comment or score on it. Where liability cannot be excluded, it is limited to the amount you paid us in the twelve months before the claim, which for most people is nothing. Nothing here limits liability that the law says cannot be limited.

## Indemnity

If your content or your use of the site draws a claim against us, you cover the cost of it.

## Ending

Stop using the site whenever you like; ask and we delete your account, as the [privacy page](${origin}/privacy) describes. We can suspend or end your access for breaking these terms.

## Changes

Versioned in the open. A material change gets a note on the site, and using the site afterwards means you accept it.

${todo("TODO governing law: add a section naming the jurisdiction once the controller is named on /privacy")}## Contact

[${contact}](mailto:${contact}) or the [contact form](${origin}/contact). Legal notices: [${abuse}](mailto:${abuse}).
`;

function page(c: Context<AppEnv>, kind: "privacy" | "terms") {
  const user = c.get("user"); const url = new URL(c.req.url);
  const origin = url.origin;
  const contact = c.env.CONTACT_EMAIL ?? "hello@slopscore.org";
  const abuse = c.env.ABUSE_EMAIL ?? "abuse@slopscore.org";
  const text = (kind === "privacy" ? privacyMd : termsMd)(origin, contact, abuse);
  const title = kind === "privacy" ? "Privacy" : "Terms of use";
  const description = kind === "privacy"
    ? "What SlopScore keeps about you, where it goes, how long it stays, and how to have it deleted. GitHub id, login and avatar; no email, no raw IP, no tracking cookies."
    : "The rules for using SlopScore: what you may post, what a listing is, what a payment buys, how takedowns work, and what we are not liable for.";
  return respond(c, { text }, {
    json: () => ({ title, updated: LEGAL_UPDATED, contact, abuse, source: SOURCE, text }),
    md: () => text,
    html: () => (
      <Layout meta={{ title: `${title} — SlopScore`, description }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        </section>
      </Layout>
    ),
  });
}

legal.get("/privacy", (c) => page(c, "privacy"));
legal.get("/terms", (c) => page(c, "terms"));
