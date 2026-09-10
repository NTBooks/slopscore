-- Subreddit-style tags ("s/cli") and weighted votes.

CREATE TABLE tags (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  blurb TEXT,
  curated INTEGER NOT NULL DEFAULT 0,      -- 1 = preseeded / promoted in the tag bar
  sort INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Votes carry a weight decided at cast time from the voter's GitHub-derived trust (see lib/trust.ts).
ALTER TABLE votes ADD COLUMN weight REAL NOT NULL DEFAULT 1;
ALTER TABLE votes ADD COLUMN ip_hash TEXT;
CREATE INDEX votes_repo_time ON votes(repo_id, created_at);
ALTER TABLE users ADD COLUMN trust REAL NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO tags (slug, title, blurb, curated, sort) VALUES
  ('cli',             'CLI tools',          'Things you run in a terminal and immediately alias.', 1, 1),
  ('devtools',        'Dev tools',          'Tools for people who make tools.', 1, 2),
  ('web-app',         'Web apps',           'It has a URL and probably a dark mode.', 1, 3),
  ('agent',           'Agents',             'Software that acts on your behalf, allegedly.', 1, 4),
  ('mcp-server',      'MCP servers',        'Tools for the agents. Yes, it goes all the way down.', 1, 5),
  ('bot',             'Bots',               'Discord, Slack, Telegram, and other places to be muted.', 1, 6),
  ('game',            'Games',              'Playable, in the broad sense.', 1, 7),
  ('automation',      'Automation',         'Cron jobs with ambition.', 1, 8),
  ('home-automation', 'Home automation',    'Your lights, but with a YAML file.', 1, 9),
  ('mobile',          'Mobile',             'Runs on a phone. Ships to a store, maybe.', 1, 10),
  ('library',         'Libraries',          'npm install regret.', 1, 11),
  ('api',             'APIs',               'REST, GraphQL, or a single POST endpoint that does everything.', 1, 12),
  ('data',            'Data',               'Pipelines, scrapers, and spreadsheets with opinions.', 1, 13),
  ('ml',              'Machine learning',   'Models, wrappers around models, and wrappers around wrappers.', 1, 14),
  ('productivity',    'Productivity',       'Todo apps. So many todo apps.', 1, 15),
  ('media',           'Media',              'Audio, video, images, and converting between them.', 1, 16),
  ('iot',             'IoT',                'Blinking lights with a network stack.', 1, 17),
  ('security',        'Security',           'Scanners, auditors, and things you should not run as root.', 1, 18),
  ('finance',         'Finance',            'Not financial advice. Disclosed as such.', 1, 19),
  ('education',       'Education',          'Flashcards, tutors, and explainers.', 1, 20),
  ('science',         'Science',            'Simulations, plots, and papers-as-code.', 1, 21),
  ('art',             'Art',                'Generative, procedural, or just pretty.', 1, 22),
  ('social',          'Social',             'Feeds, forums, and places to argue.', 1, 23),
  ('infra',           'Infra',              'Deploy, monitor, scale, weep.', 1, 24),
  ('plugin',          'Plugins & extensions','Lives inside something else.', 1, 25),
  ('template',        'Templates',          'Starter kits and scaffolds.', 1, 26),
  ('toy',             'Toys',               'Built for fun. Graded anyway.', 1, 27),
  ('other',           'Other',              'Defies categorisation. Suspicious.', 1, 99);
