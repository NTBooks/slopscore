-- Slopbuckets: the subreddit-style groupings. The `tags` table is the bucket registry; this adds banning + provenance.
ALTER TABLE tags ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN banned_reason TEXT;
ALTER TABLE tags ADD COLUMN created_by TEXT;   -- 'seed' | repo full_name that first declared it | admin login

UPDATE tags SET created_by = 'seed' WHERE created_by IS NULL;

INSERT OR IGNORE INTO tags (slug, title, blurb, curated, sort, created_by) VALUES
  ('vibe-coded',       'Vibe coded',        'Prompted into existence. Nobody read the diff.', 1, 28, 'seed'),
  ('weekend-project',  'Weekend projects',  'Started Saturday. Status: works-on-my-machine.', 1, 29, 'seed'),
  ('ai-wrapper',       'AI wrappers',       'A prompt, an API key, and a landing page.', 1, 30, 'seed'),
  ('chrome-extension', 'Browser extensions','Lives in your toolbar, asks for all permissions.', 1, 31, 'seed'),
  ('discord-bot',      'Discord bots',      'Responds to !commands and existential dread.', 1, 32, 'seed'),
  ('scraper',          'Scrapers',          'Politely disclosed as scraping.', 1, 33, 'seed'),
  ('dashboard',        'Dashboards',        'Charts of things. Sometimes the right things.', 1, 34, 'seed'),
  ('todo-app',         'Todo apps',         'The hello world of slop.', 1, 35, 'seed'),
  ('mcp-tools',        'MCP tools',         'Tools for the agents that write the tools.', 1, 36, 'seed');
