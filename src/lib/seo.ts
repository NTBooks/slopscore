// Structured data for the pieces search engines can show as more than a blue link.
// Everything here is built from rows we already display: no invented ratings, no fields the page does not back up.
import type { RepoRow } from "./db";
import type { TagRow } from "./slopmd";

/**
 * A listing as the thing it actually is — a code repository someone else wrote — plus the two
 * numbers this site adds: how many people upvoted it and how many commented. Votes are not a
 * 1-5 rating, so they go in as interaction counts rather than an aggregateRating we would be making up.
 */
export function repoJsonLd(url: URL, r: RepoRow, tags: TagRow[], comments: number): unknown[] {
  const page = `${url.origin}/r/${r.full_name}`;
  const langs = [...new Set(tags.filter((t) => t.facet === "language").map((t) => t.value))];
  const keywords = [...new Set(tags.filter((t) => ["slopbucket", "category", "built_with", "topic"].includes(t.facet)).map((t) => t.value))];
  const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : undefined);
  return [
    {
      "@type": "SoftwareSourceCode",
      "@id": `${page}#software`,
      name: r.title ?? r.name,
      headline: r.title ?? r.name,
      description: r.tagline ?? undefined,
      url: page,
      codeRepository: `https://github.com/${r.full_name}`,
      programmingLanguage: langs.length ? langs : r.language ? [r.language] : undefined,
      license: r.license ? `https://spdx.org/licenses/${r.license}` : undefined,
      author: { "@type": "Person", name: r.owner, url: `https://github.com/${r.owner}` },
      dateCreated: iso(r.gh_created_at),
      dateModified: iso(r.md_updated_at ?? r.pushed_at ?? r.listed_at),
      keywords: keywords.length ? keywords.join(", ") : undefined,
      isAccessibleForFree: true,
      interactionStatistic: [
        { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: r.up },
        { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: comments },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "SlopScupper", item: `${url.origin}/` },
        { "@type": "ListItem", position: 2, name: r.owner, item: `${url.origin}/u/${r.owner}` },
        { "@type": "ListItem", position: 3, name: r.title ?? r.name, item: page },
      ],
    },
  ];
}
