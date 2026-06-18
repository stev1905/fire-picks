-- Run this in the Supabase SQL editor once.
-- Dashboard → SQL Editor → paste and run.

-- 1. Daily per-batter prediction + actual outcome ─────────────────────────────

CREATE TABLE IF NOT EXISTS batter_outcomes (
  date          DATE        NOT NULL,
  batter_id     INTEGER     NOT NULL,
  batter_name   TEXT        NOT NULL,
  team          TEXT,
  game_pk       INTEGER,
  -- Pre-game model predictions
  hit_score     SMALLINT,
  hr_score      SMALLINT,
  -- Actual outcome that day
  got_hit       BOOLEAN     NOT NULL,
  got_hr        BOOLEAN     NOT NULL,
  at_bats       SMALLINT,
  hits          SMALLINT,
  hrs           SMALLINT,
  -- Key pre-game features (for retraining without hitting MLB API again)
  features      JSONB,
  PRIMARY KEY (date, batter_id)
);

-- Allow anon reads and writes (same policy as snapshots table)
ALTER TABLE batter_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read"   ON batter_outcomes FOR SELECT USING (true);
CREATE POLICY "anon insert" ON batter_outcomes FOR INSERT WITH CHECK (true);
CREATE POLICY "anon upsert" ON batter_outcomes FOR UPDATE USING (true);

-- Index for range queries used by the recalibration function
CREATE INDEX IF NOT EXISTS batter_outcomes_date_idx ON batter_outcomes (date DESC);

-- 2. Current model weights (one row per model: 'hit' and 'hr') ────────────────

CREATE TABLE IF NOT EXISTS model_config (
  model           TEXT        PRIMARY KEY,  -- 'hit' or 'hr'
  weights         JSONB       NOT NULL,
  trained_on      DATE,
  n_observations  INTEGER,
  auc_roc         REAL,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE model_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read"   ON model_config FOR SELECT USING (true);
CREATE POLICY "anon insert" ON model_config FOR INSERT WITH CHECK (true);
CREATE POLICY "anon upsert" ON model_config FOR UPDATE USING (true);

-- Seed with current weights from model-weights.ts so apply-weights.mjs works on day 1
INSERT INTO model_config (model, weights, trained_on, n_observations, auc_roc)
VALUES
  ('hit', '{
    "form": 20,
    "consistency": 18,
    "vsHand": 16,
    "homeAway": 7,
    "streak": 5,
    "xBA": 9,
    "hardHit": 3,
    "pitcherH": 4,
    "h2h": 3
  }', CURRENT_DATE, 5224, 0.6435),
  ('hr', '{
    "recentHR": 22,
    "seasonSLG": 12,
    "slgVsHand": 11,
    "recentSLG": 10,
    "barrel": 12,
    "hardHit": 8,
    "pitcherHR": 7,
    "park": 3
  }', CURRENT_DATE, 5224, 0.9189)
ON CONFLICT (model) DO NOTHING;
