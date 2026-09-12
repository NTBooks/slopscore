// "But is it slop though?" — a questionnaire you can send somebody who has not decided whether the
// thing they built counts. Seven questions, every honest path lands on yes, and the verdict hands over
// a slopscore.md drafted from the answers. The punchline and the call to action are the same object.
//
// No database, no account, no stored result: the answers live in the URL as ?a=3120213 and nowhere
// else. The form is a plain GET, so the page works with scripting off; public/quiz.js only reveals one
// question at a time on top of it and never scores anything. All the scoring is in lib/slopquiz.
//
// Same house rule as the orphanage: mock the genre, never the maker.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { Mascot } from "../views/art";
import { QUESTIONS, TIERS, scoreAnswers, encodeAnswers, decodeAnswers, answersFromFields, draftFile, type Answers } from "../lib/slopquiz";

export const quiz = new Hono<AppEnv>();

/** The router is mounted twice; every canonical, form action and share link uses this one. */
const PATH = "/but-is-it-slop";
const TITLE = "But is it slop though?";

function Questions(p: { pre: (number | null)[]; partial: boolean }) {
  return (
    <>
      <form class="quizform" method="get" action={PATH}>
        {QUESTIONS.map((q, i) => (
          <fieldset class="q">
            <legend><span class="n">{i + 1}</span> {q.prompt}</legend>
            {q.options.map((o, j) => (
              <label class="opt">
                <input type="radio" name={`q${i + 1}`} value={String(j)} required checked={p.pre[i] === j ? true : undefined} />
                <span>{o.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <p class="quizgo">
          <button class="btn" type="submit">Deliver the verdict</button>
          {p.partial ? <span class="muted small">All seven, please. The Cap'm does not extrapolate.</span> : <span class="muted small">Nothing is stored. The answers go in the address bar and stay there.</span>}
        </p>
      </form>
      <p class="muted small">Already know the answer? The file is six lines: <a href="/spec">the spec</a> · <a href="/disclosure">why it exists</a> · <a href="/scan">scan a repo</a>.</p>
    </>
  );
}

function Verdict(p: { answers: Answers; origin: string }) {
  const s = scoreAnswers(p.answers);
  const draft = draftFile(p.answers);
  const share = `${p.origin}${PATH}?a=${encodeAnswers(p.answers)}`;
  return (
    <>
      <div class="tierbox">
        <p class="est">The verdict</p>
        <h1>{s.tier.name}</h1>
        <div class="scorestrip" role="img" aria-label={`${s.points} out of ${s.max}`}><span style={`width:${s.pct}%`}></span></div>
        <p class="scoreline"><strong>{s.points} of {s.max}</strong> <span class="muted">· {s.pct}% slop by volume · {TIERS.findIndex((t) => t === s.tier) + 1} of {TIERS.length} on the scale</span></p>
      </div>

      {s.tier.verdict.map((para) => <p>{para}</p>)}

      <h2>What you said, and what the Cap'm wrote down</h2>
      <ol class="notes">
        {QUESTIONS.map((q, i) => {
          const o = q.options[p.answers[i]];
          return (
            <li>
              <p class="asked">{q.prompt}</p>
              <p class="gave">{o.label}</p>
              <p class="capm">{o.note}</p>
            </li>
          );
        })}
      </ol>

      <div class="doorstep">
        <h2>Your <code>slopscore.md</code>, already written</h2>
        <p>This is the file, filled in from the seven answers above. Put it in the root of the public repo and Schnitzel picks it up, usually within the hour. No form, no account, no app to install.</p>
        <div class="copybox">
          <textarea readonly rows={draft.trim().split("\n").length} spellcheck={false} aria-label="Your draft slopscore.md">{draft.trim()}</textarea>
          <button class="btn secondary" type="button" data-copy>copy</button>
        </div>
        <p class="muted small">Two placeholders left, because this page cannot know them: <code>category</code> and <code>built_with</code>. Everything else came from your answers. <a href="/spec">Full spec</a> · <a href="/disclosure">what this file is for</a>.</p>
        <p><a class="btn" href="/spec">Read the spec</a> <a class="btn secondary" href="/scan">Scan the repo now</a> <a class="btn secondary" href="/">See the feed</a></p>
      </div>

      <div class="doorstep">
        <h2>Send somebody else through it</h2>
        <p>This link carries your answers and nothing else. It is the whole record: there is no row in a database with your name on it, because there is no row.</p>
        <div class="copybox one">
          <input type="text" readonly data-selectall value={share} aria-label="Link to this verdict" />
          <button class="btn secondary" type="button" data-copy>copy</button>
        </div>
        <p class="muted small"><a href={PATH}>Take it again</a> · <a href="/orphanage">what this place is</a> · <a href="/best">the ones that turned out to be truffles</a></p>
      </div>
    </>
  );
}

quiz.get("/", (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);

  // A submission from the plain form arrives as q1..q7. Fold it into the short shareable URL.
  if (!url.searchParams.has("a") && url.searchParams.has("q1")) {
    const fromForm = answersFromFields((n) => c.req.query(n));
    if (fromForm) return c.redirect(`${PATH}?a=${encodeAnswers(fromForm)}`, 302);
  }

  const answers = decodeAnswers(url.searchParams.get("a"));
  const pre = QUESTIONS.map((_, i) => {
    const raw = Number(c.req.query(`q${i + 1}`));
    return Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : null;
  });
  const partial = !answers && pre.some((x) => x !== null);

  const meta = answers
    ? {
        title: `${scoreAnswers(answers).tier.name} — ${TITLE}`,
        description: scoreAnswers(answers).tier.share,
        image: `${url.origin}/quiz.png`,
        // 16,384 permutations of the same page is not a sitemap, it is a landfill. One of them is indexed.
        noindex: true,
        canonical: `${url.origin}${PATH}`,
      }
    : {
        title: `${TITLE} — SlopScore`,
        description: "Seven questions about the thing you just built. Every honest answer lands in the trough, including the one where you typed every line yourself.",
        image: `${url.origin}/quiz.png`,
        canonical: `${url.origin}${PATH}`,
      };

  return c.html(
    <Layout meta={meta} user={user} url={url}>
      <section class="wrap narrow orphanage sloptest" style="padding:0">
        <div class="hero">
          <Mascot size={130} class="hero-pig" />
          <div>
            <p class="est">Seven questions · No login · Nothing stored · Schnitzel presiding</p>
            <h1>{TITLE}</h1>
            <p>You built a thing. Somebody has implied, possibly you, at 1am, that it might be slop. There is only one way to settle this and it takes about forty seconds.</p>
          </div>
        </div>
        {answers ? <Verdict answers={answers} origin={url.origin} /> : <Questions pre={pre} partial={partial} />}
      </section>
      <script src="/quiz.js" defer></script>
    </Layout>,
  );
});
