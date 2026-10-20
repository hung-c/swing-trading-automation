-- Postgres schema (Neon). Applied automatically by `swing db-init` and on first connect from the pipeline.
-- The web app (web/) reads and writes the same tables. All statements are idempotent.

CREATE TABLE IF NOT EXISTS plans (
  plan_date     DATE NOT NULL,
  symbol        TEXT NOT NULL,
  pattern       TEXT,
  resistance    DOUBLE PRECISION,
  entry         DOUBLE PRECISION,
  stop          DOUBLE PRECISION,
  shares        INTEGER,
  target_2r     DOUBLE PRECISION,
  status        TEXT,
  quality       DOUBLE PRECISION,
  trend_score   INTEGER,
  sector        TEXT,
  earnings_date DATE,
  payload       JSONB NOT NULL,
  PRIMARY KEY (plan_date, symbol)
);

-- One row per saved plan. A ticker can hold several. original_payload is the card from the moment it was saved.
-- Alerts use active saved rows. Candidates wait until the user adds or switches. Turned-off rows stay.
CREATE TABLE IF NOT EXISTS watchlist (
  id                TEXT PRIMARY KEY,
  symbol            TEXT NOT NULL,
  saved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_date         DATE,
  active            INTEGER NOT NULL DEFAULT 1,
  role              TEXT NOT NULL DEFAULT 'saved',
  original_payload  JSONB NOT NULL,
  verdict           TEXT,
  verdict_reason    TEXT,
  verdict_at        TIMESTAMPTZ,
  triggered         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS watchlist_symbol_idx ON watchlist (symbol);

CREATE TABLE IF NOT EXISTS positions (
  symbol         TEXT PRIMARY KEY,
  opened         DATE,
  entry          DOUBLE PRECISION,
  stop           DOUBLE PRECISION,
  initial_stop   DOUBLE PRECISION,
  shares         DOUBLE PRECISION,
  target_2r      DOUBLE PRECISION,
  pattern        TEXT,
  sector         TEXT,
  half_sold      INTEGER DEFAULT 0,
  closed         DATE,
  exit_price     DOUBLE PRECISION,
  r_multiple     DOUBLE PRECISION,
  resistance     DOUBLE PRECISION,
  plan_id        TEXT,
  original_plan  JSONB,
  stance         TEXT,
  stance_reason  TEXT,
  stance_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trades (
  id           BIGSERIAL PRIMARY KEY,
  symbol       TEXT,
  opened       DATE,
  closed       DATE,
  entry        DOUBLE PRECISION,
  initial_stop DOUBLE PRECISION,
  exit_price   DOUBLE PRECISION,
  shares       DOUBLE PRECISION,
  r_multiple   DOUBLE PRECISION,
  pattern      TEXT,
  sector       TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  day        DATE NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  symbol     TEXT NOT NULL,
  condition  TEXT NOT NULL,
  plan_id    TEXT NOT NULL DEFAULT '',
  price      DOUBLE PRECISION,
  rvol       DOUBLE PRECISION,
  vwap       DOUBLE PRECISION,
  actionable INTEGER,
  message    TEXT,
  PRIMARY KEY (day, symbol, condition, plan_id)
);
CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts (ts DESC);

CREATE TABLE IF NOT EXISTS briefs (
  brief_date DATE NOT NULL,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (brief_date, kind)
);

CREATE TABLE IF NOT EXISTS kv (
  k          TEXT PRIMARY KEY,
  v          JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User-defined strategy documents. The payload is the rule set, including the evaluator text (see web/lib/strategy.ts).
CREATE TABLE IF NOT EXISTS strategies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chart PNGs live in the database (a few MB per night; pruned after 21 days) so no blob store is needed.
CREATE TABLE IF NOT EXISTS charts (
  day    DATE NOT NULL,
  symbol TEXT NOT NULL,
  kind   TEXT NOT NULL,
  png    BYTEA NOT NULL,
  PRIMARY KEY (day, symbol, kind)
);

-- One row per job invocation (step is null) and one row per step. status=running until finish.
CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGSERIAL PRIMARY KEY,
  job         TEXT NOT NULL,
  step        TEXT,
  status      TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  summary     JSONB,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS job_runs_lookup_idx ON job_runs (job, step, started_at DESC);
