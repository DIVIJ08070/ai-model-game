-- Body Dash leaderboard schema.
-- The API (api/scores.js) also runs CREATE TABLE IF NOT EXISTS lazily on first use,
-- so applying this by hand is OPTIONAL — provided for anyone who prefers to provision
-- the table up front (e.g. in the Neon / Supabase SQL editor).

CREATE TABLE IF NOT EXISTS scores (
  id    BIGSERIAL   PRIMARY KEY,
  name  TEXT        NOT NULL,
  score INTEGER     NOT NULL,
  diff  TEXT        NOT NULL DEFAULT 'normal',   -- chill | normal | intense
  dist  INTEGER,                                 -- metres travelled (nullable)
  ts    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports "top N within a difficulty, score desc, oldest-first tiebreak" reads and
-- the rank computation without a full table scan as the table grows.
CREATE INDEX IF NOT EXISTS scores_diff_score_idx ON scores (diff, score DESC, ts ASC);
