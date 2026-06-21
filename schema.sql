CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  club_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  stadium TEXT,
  city TEXT,
  balance INTEGER DEFAULT 5000000,
  transfer_budget INTEGER DEFAULT 2000000,
  wage_budget INTEGER DEFAULT 500000,
  reputation INTEGER DEFAULT 50,
  is_user_club INTEGER DEFAULT 0,
  is_ai INTEGER DEFAULT 1,
  strength_tendency REAL DEFAULT 0.5,
  user_id INTEGER,
  wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER DEFAULT 0,
  first_name TEXT,
  last_name TEXT,
  age INTEGER,
  nationality TEXT,
  position TEXT,
  ovr INTEGER DEFAULT 50,
  potential INTEGER DEFAULT 60,
  pace INTEGER DEFAULT 50,
  shooting INTEGER DEFAULT 50,
  passing INTEGER DEFAULT 50,
  defending INTEGER DEFAULT 50,
  physical INTEGER DEFAULT 50,
  goalkeeping INTEGER DEFAULT 50,
  value INTEGER DEFAULT 100000,
  salary INTEGER DEFAULT 5000,
  fitness INTEGER DEFAULT 100,
  morale INTEGER DEFAULT 80,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  appearances INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  injury_type TEXT,
  injury_weeks INTEGER DEFAULT 0,
  suspended INTEGER DEFAULT 0,
  is_listed INTEGER DEFAULT 0,
  asking_price INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matchday INTEGER,
  home_team_id INTEGER,
  away_team_id INTEGER,
  home_goals INTEGER,
  away_goals INTEGER,
  simulated INTEGER DEFAULT 0,
  events TEXT,
  home_possession INTEGER,
  away_possession INTEGER,
  home_shots INTEGER,
  away_shots INTEGER,
  home_shots_on_target INTEGER,
  away_shots_on_target INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  home_fouls INTEGER,
  away_fouls INTEGER,
  played_at DATETIME
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER,
  from_club_id INTEGER,
  to_club_id INTEGER,
  fee INTEGER,
  matchday INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  title TEXT,
  message TEXT,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS season (
  id INTEGER PRIMARY KEY DEFAULT 1,
  season_number INTEGER DEFAULT 1,
  current_matchday INTEGER DEFAULT 1,
  total_matchdays INTEGER DEFAULT 38,
  status TEXT DEFAULT 'active'
);
