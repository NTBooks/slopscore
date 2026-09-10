# Denylist sources

- `profanity-en.txt` — LDNOOBW "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (English), CC-BY-4.0, https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words. Used to **flag** (adds risk), never to reject on its own: it contains plenty of words that are fine in a README.
- `spam.txt` — spam phrases. Flag + risk.
- `domains.txt` — URL shorteners and known abuse hosts. Links to these **reject**.
- Hate speech is detected by Llama Guard (category S10) in the content gate, not by a word list. Admins can add `slur`-kind terms in the `denylist` table from `/mod`; those reject when they appear in a title, tagline, tag, or owner login.
