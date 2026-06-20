const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'pitch-manager.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
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
    name TEXT UNIQUE NOT NULL,
    short_name TEXT NOT NULL,
    stadium TEXT NOT NULL,
    city TEXT NOT NULL,
    balance INTEGER DEFAULT 50000000,
    transfer_budget INTEGER DEFAULT 20000000,
    wage_budget INTEGER DEFAULT 5000000,
    reputation INTEGER DEFAULT 50,
    is_ai INTEGER DEFAULT 1,
    strength_tendency REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    age INTEGER NOT NULL,
    position TEXT NOT NULL,
    ovr INTEGER NOT NULL,
    pace INTEGER NOT NULL,
    shooting INTEGER NOT NULL,
    passing INTEGER NOT NULL,
    defending INTEGER NOT NULL,
    physical INTEGER NOT NULL,
    goalkeeping INTEGER NOT NULL,
    potential INTEGER NOT NULL,
    value INTEGER NOT NULL,
    salary INTEGER NOT NULL,
    fitness INTEGER DEFAULT 100,
    morale INTEGER DEFAULT 75,
    is_listed INTEGER DEFAULT 0,
    asking_price INTEGER DEFAULT 0,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    yellow_cards INTEGER DEFAULT 0,
    red_cards INTEGER DEFAULT 0,
    appearances INTEGER DEFAULT 0,
    injury_type TEXT DEFAULT NULL,
    injury_weeks INTEGER DEFAULT 0,
    suspended INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matchday INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL,
    away_team_id INTEGER NOT NULL,
    home_goals INTEGER,
    away_goals INTEGER,
    simulated INTEGER DEFAULT 0,
    events TEXT,
    played_at DATETIME,
    home_formation TEXT DEFAULT '4-3-3',
    away_formation TEXT DEFAULT '4-3-3',
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
    FOREIGN KEY (home_team_id) REFERENCES clubs(id),
    FOREIGN KEY (away_team_id) REFERENCES clubs(id)
  );

  CREATE TABLE IF NOT EXISTS season (
    id INTEGER PRIMARY KEY DEFAULT 1,
    current_matchday INTEGER DEFAULT 1,
    total_matchdays INTEGER DEFAULT 38,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    from_club_id INTEGER NOT NULL,
    to_club_id INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    matchday INTEGER NOT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (from_club_id) REFERENCES clubs(id),
    FOREIGN KEY (to_club_id) REFERENCES clubs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_players_club ON players(club_id);
  CREATE INDEX IF NOT EXISTS idx_matches_matchday ON matches(matchday);
  CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
  CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
`);

// ─── Initialize season if not exists ─────────────────────────────────────────
const season = db.prepare('SELECT * FROM season WHERE id = 1').get();
if (!season) {
  db.prepare("INSERT INTO season (id, current_matchday, total_matchdays, status) VALUES (1, 1, 38, 'active')").run();
}

module.exports = db;
