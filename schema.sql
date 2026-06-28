-- Pitch Manager - PostgreSQL Schema
-- Works with: Supabase, Neon, Vercel Postgres, local PostgreSQL

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  club_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Clubs ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clubs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(10) NOT NULL DEFAULT 'UNK',
  stadium VARCHAR(100),
  city VARCHAR(100),
  balance BIGINT DEFAULT 50000000,
  transfer_budget BIGINT DEFAULT 25000000,
  wage_budget BIGINT DEFAULT 6000000,
  reputation INTEGER DEFAULT 50,
  is_ai BOOLEAN DEFAULT TRUE,
  strength_tendency REAL DEFAULT 0.5,
  user_id INTEGER REFERENCES users(id),
  tactics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key for users.club_id (safe - won't fail if already exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_club') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_club 
      FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Players ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  age INTEGER NOT NULL,
  position VARCHAR(5) NOT NULL,
  ovr INTEGER NOT NULL DEFAULT 50,
  potential INTEGER NOT NULL DEFAULT 60,
  -- Attributes
  pace INTEGER DEFAULT 50,
  shooting INTEGER DEFAULT 50,
  passing INTEGER DEFAULT 50,
  defending INTEGER DEFAULT 50,
  physical INTEGER DEFAULT 50,
  goalkeeping INTEGER DEFAULT 50,
  -- Status
  fitness INTEGER DEFAULT 90,
  morale INTEGER DEFAULT 70,
  form INTEGER DEFAULT 70,
  injury_type VARCHAR(50),
  injury_weeks INTEGER DEFAULT 0,
  suspended BOOLEAN DEFAULT FALSE,
  -- Season stats (reset each season)
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  appearances INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  -- Career stats (never reset)
  career_goals INTEGER DEFAULT 0,
  career_assists INTEGER DEFAULT 0,
  career_appearances INTEGER DEFAULT 0,
  career_yellow_cards INTEGER DEFAULT 0,
  career_red_cards INTEGER DEFAULT 0,
  career_clean_sheets INTEGER DEFAULT 0,
  career_motm INTEGER DEFAULT 0,
  -- Contract
  value BIGINT DEFAULT 100000,
  salary BIGINT DEFAULT 2000,
  contract_years INTEGER DEFAULT 3,
  -- Transfer market
  is_listed BOOLEAN DEFAULT FALSE,
  asking_price BIGINT DEFAULT 0,
  -- History
  season_history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_club ON players(club_id);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_ovr ON players(ovr DESC);

-- ─── Matches ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  matchday INTEGER NOT NULL,
  home_team_id INTEGER NOT NULL REFERENCES clubs(id),
  away_team_id INTEGER NOT NULL REFERENCES clubs(id),
  home_goals INTEGER DEFAULT 0,
  away_goals INTEGER DEFAULT 0,
  simulated BOOLEAN DEFAULT FALSE,
  events JSONB DEFAULT '[]',
  -- Match stats
  home_possession INTEGER DEFAULT 50,
  away_possession INTEGER DEFAULT 50,
  home_shots INTEGER DEFAULT 0,
  away_shots INTEGER DEFAULT 0,
  home_shots_on_target INTEGER DEFAULT 0,
  away_shots_on_target INTEGER DEFAULT 0,
  home_corners INTEGER DEFAULT 0,
  away_corners INTEGER DEFAULT 0,
  home_fouls INTEGER DEFAULT 0,
  away_fouls INTEGER DEFAULT 0,
  played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_matchday ON matches(matchday);
CREATE INDEX IF NOT EXISTS idx_matches_simulated ON matches(simulated);
CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);

-- ─── Transfers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  from_club_id INTEGER,
  to_club_id INTEGER,
  fee BIGINT DEFAULT 0,
  matchday INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_player ON transfers(player_id);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ─── Meta (season, game state) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (
  key VARCHAR(50) PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Awards (season history) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS awards (
  id SERIAL PRIMARY KEY,
  season_number INTEGER NOT NULL UNIQUE,
  champion JSONB,
  top_scorer JSONB,
  top_assister JSONB,
  best_young JSONB,
  relegated JSONB DEFAULT '[]',
  promoted JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Initialize default season ────────────────────────────────────────────────
INSERT INTO meta (key, data) VALUES ('season', '{"seasonNumber": 1, "currentMatchday": 1, "totalMatchdays": 38, "status": "active"}')
ON CONFLICT (key) DO NOTHING;
