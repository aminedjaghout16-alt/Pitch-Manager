const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { getDb } = require('./db');
const { generatePlayer, insertPlayer, generateTransferMarket, calculateOVR } = require('./player-generator');
const { simulateMatchday, getTeamStrength } = require('./match-simulator');
const {
  initializeGame, createUserClub, getStandings, getSeason,
  advanceMatchday, getCurrentMatchdayFixtures, aiTransferActions
} = require('./league-manager');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'pitch-manager-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper
function formatMoney(n) {
  if (n == null) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n < 0 ? '-' : '') + '$' + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return (n < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(0) + 'K';
  return '$' + n.toLocaleString();
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, username, email, club_id FROM users WHERE id = ?',
      args: [decoded.id]
    });
    req.user = result.rows[0];
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireClub(req, res, next) {
  if (!req.user.club_id) return res.status(400).json({ error: 'You must create a club first' });
  next();
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDb();
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE username = ? OR email = ?',
      args: [username, email]
    });
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username or email already exists' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.execute({
      sql: 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      args: [username, email, hash]
    });
    const id = Number(result.lastInsertRowid);
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id, username, email, club_id: null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE username = ? OR email = ?',
      args: [username, username]
    });
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, club_id: user.club_id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// ─── Club Routes ─────────────────────────────────────────────────────────────
app.post('/api/club/create', auth, async (req, res) => {
  if (req.user.club_id) return res.status(400).json({ error: 'You already have a club' });
  const { name, stadium, city } = req.body;
  if (!name || !stadium || !city) return res.status(400).json({ error: 'All fields are required' });

  try {
    const clubId = await createUserClub(req.user.id, name, stadium, city);
    const db = getDb();
    const result = await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [clubId] });
    res.json({ club: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/club', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const club = (await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    const squadSize = (await db.execute({ sql: 'SELECT COUNT(*) as count FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0].count;
    const wages = (await db.execute({ sql: 'SELECT SUM(salary) as total FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0];
    res.json({ club, squadSize, totalWages: wages.total || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const club = (await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    const season = await getSeason();
    const standings = await getStandings();
    const userStanding = standings.find(s => s.club_id === req.user.club_id);

    const nextMatch = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m
            JOIN clubs c1 ON m.home_team_id = c1.id
            JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.matchday = ? AND (m.home_team_id = ? OR m.away_team_id = ?) AND m.simulated = 0 LIMIT 1`,
      args: [season.current_matchday, req.user.club_id, req.user.club_id]
    })).rows[0] || null;

    const lastMatch = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m
            JOIN clubs c1 ON m.home_team_id = c1.id
            JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?)
            ORDER BY m.played_at DESC LIMIT 1`,
      args: [req.user.club_id, req.user.club_id]
    })).rows[0] || null;

    const squadSummary = (await db.execute({
      sql: 'SELECT position, COUNT(*) as count, ROUND(AVG(ovr), 1) as avg_ovr FROM players WHERE club_id = ? GROUP BY position',
      args: [req.user.club_id]
    })).rows;

    const totalWages = (await db.execute({ sql: 'SELECT SUM(salary) as total FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0].total || 0;

    res.json({ club, season, standing: userStanding, nextMatch, lastMatch, squadSummary, totalWages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Squad Routes ────────────────────────────────────────────────────────────
app.get('/api/squad', auth, requireClub, async (req, res) => {
  try {
    const { sort = 'ovr', order = 'desc', position } = req.query;
    const allowedSorts = ['ovr', 'age', 'value', 'salary', 'fitness', 'morale', 'position', 'potential', 'pace', 'shooting', 'passing', 'defending', 'physical', 'goalkeeping'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'ovr';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const db = getDb();
    let sql = 'SELECT * FROM players WHERE club_id = ?';
    const args = [req.user.club_id];
    if (position) { sql += ' AND position = ?'; args.push(position); }
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    const players = (await db.execute({ sql, args })).rows;
    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/squad/:id', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ? AND club_id = ?', args: [req.params.id, req.user.club_id] })).rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json({ player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Transfer Market ─────────────────────────────────────────────────────────
app.get('/api/transfers/market', auth, requireClub, async (req, res) => {
  try {
    const { sort = 'ovr', order = 'desc', position, maxPrice } = req.query;
    const allowedSorts = ['ovr', 'age', 'value', 'asking_price', 'potential', 'pace', 'shooting', 'passing', 'defending', 'physical'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'ovr';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const db = getDb();
    let sql = 'SELECT * FROM players WHERE club_id = 0 AND is_listed = 1';
    const args = [];
    if (position) { sql += ' AND position = ?'; args.push(position); }
    if (maxPrice) { sql += ' AND asking_price <= ?'; args.push(parseInt(maxPrice)); }
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    const players = (await db.execute({ sql, args })).rows;
    const club = (await db.execute({ sql: 'SELECT transfer_budget FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    res.json({ players, budget: club.transfer_budget });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transfers/buy/:playerId', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ? AND club_id = 0 AND is_listed = 1', args: [req.params.playerId] })).rows[0];
    if (!player) return res.status(404).json({ error: 'Player not available on transfer market' });

    const club = (await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    if (club.transfer_budget < player.asking_price) return res.status(400).json({ error: 'Insufficient transfer budget' });

    const squadCount = (await db.execute({ sql: 'SELECT COUNT(*) as count FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0].count;
    if (squadCount >= 30) return res.status(400).json({ error: 'Squad is full (max 30 players)' });

    const season = await getSeason();

    await db.batch([
      { sql: 'UPDATE players SET club_id = ?, is_listed = 0, asking_price = 0 WHERE id = ?', args: [req.user.club_id, player.id] },
      { sql: 'UPDATE clubs SET transfer_budget = transfer_budget - ?, balance = balance - ? WHERE id = ?', args: [player.asking_price, player.asking_price, req.user.club_id] },
      { sql: 'INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday) VALUES (?, 0, ?, ?, ?)', args: [player.id, req.user.club_id, player.asking_price, season.current_matchday] }
    ]);

    await createNotification(req.user.id, 'transfer_in', 'Player Signed', `${player.first_name} ${player.last_name} has joined your club for ${formatMoney(player.asking_price)}`);
    res.json({ message: `Successfully signed ${player.first_name} ${player.last_name}`, player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transfers/listed', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const players = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ? AND is_listed = 1', args: [req.user.club_id] })).rows;
    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transfers/sell/:playerId', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ? AND club_id = ?', args: [req.params.playerId, req.user.club_id] })).rows[0];
    if (!player) return res.status(404).json({ error: 'Player not in your squad' });

    const squadCount = (await db.execute({ sql: 'SELECT COUNT(*) as count FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0].count;
    if (squadCount <= 16) return res.status(400).json({ error: 'Cannot sell: minimum squad size is 16' });

    const season = await getSeason();
    const sellPrice = Math.round(player.value * 0.9);
    const listPrice = player.asking_price || Math.round(player.value * 1.1);

    await db.batch([
      { sql: 'UPDATE players SET club_id = 0, is_listed = 1, asking_price = ? WHERE id = ?', args: [listPrice, player.id] },
      { sql: 'UPDATE clubs SET transfer_budget = transfer_budget + ?, balance = balance + ? WHERE id = ?', args: [sellPrice, sellPrice, req.user.club_id] },
      { sql: 'INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday) VALUES (?, ?, 0, ?, ?)', args: [player.id, req.user.club_id, sellPrice, season.current_matchday] }
    ]);

    res.json({ message: `${player.first_name} ${player.last_name} listed for sale. Received ${formatMoney(sellPrice)} compensation.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Training ────────────────────────────────────────────────────────────────
app.get('/api/training', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const players = (await db.execute({
      sql: 'SELECT id, first_name, last_name, age, position, ovr, potential, fitness, morale FROM players WHERE club_id = ? ORDER BY ovr DESC',
      args: [req.user.club_id]
    })).rows;
    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/training/:playerId', auth, requireClub, async (req, res) => {
  try {
    const { focus } = req.body;
    const db = getDb();
    const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ? AND club_id = ?', args: [req.params.playerId, req.user.club_id] })).rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.fitness < 30) return res.status(400).json({ error: 'Player fitness too low for training. Wait for recovery.' });

    const trainingCost = 10000;
    const club = (await db.execute({ sql: 'SELECT balance FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    if (club.balance < trainingCost) return res.status(400).json({ error: 'Insufficient funds for training' });

    const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
    const potentialGap = player.potential - player.ovr;
    let improvement = 0;
    if (potentialGap > 0) {
      improvement = Math.ceil(Math.random() * 2 * ageFactor);
      improvement = Math.min(improvement, Math.ceil(potentialGap / 5));
    } else {
      improvement = Math.random() < 0.2 ? 1 : 0;
    }

    const updates = {};
    const focusAttrs = focus === 'general' ? ['pace', 'shooting', 'passing', 'defending', 'physical'] : [focus];
    const stmts = [];

    for (const attr of focusAttrs) {
      if (attr === 'general') continue;
      const gain = attr === focus ? improvement : (improvement > 0 && Math.random() < 0.3 ? 1 : 0);
      if (gain > 0 && player[attr] < 99) {
        const newVal = Math.min(99, player[attr] + gain);
        updates[attr] = newVal;
        stmts.push({ sql: `UPDATE players SET ${attr} = ? WHERE id = ?`, args: [newVal, player.id] });
      }
    }

    const updatedAttrs = { ...player, ...updates };
    const newOvr = calculateOVR(player.position, updatedAttrs);
    const fitnessDrop = Math.floor(Math.random() * 8) + 5;

    stmts.push({ sql: 'UPDATE players SET ovr = ? WHERE id = ?', args: [newOvr, player.id] });
    stmts.push({ sql: 'UPDATE players SET fitness = MAX(40, fitness - ?) WHERE id = ?', args: [fitnessDrop, player.id] });
    stmts.push({ sql: 'UPDATE clubs SET balance = balance - ? WHERE id = ?', args: [trainingCost, req.user.club_id] });

    if (stmts.length > 0) await db.batch(stmts);

    const updated = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [player.id] })).rows[0];
    res.json({ message: `Training complete for ${player.first_name} ${player.last_name}`, player: updated, improvements: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/training/batch', auth, requireClub, async (req, res) => {
  try {
    const { focus } = req.body;
    const db = getDb();
    const players = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ? AND fitness >= 30', args: [req.user.club_id] })).rows;
    const trainingCost = 10000 * players.length;

    const club = (await db.execute({ sql: 'SELECT balance FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    if (club.balance < trainingCost) return res.status(400).json({ error: `Insufficient funds. Need ${formatMoney(trainingCost)} for full squad training.` });

    const results = [];
    const stmts = [];

    for (const player of players) {
      const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
      const potentialGap = player.potential - player.ovr;
      let improved = false;
      let updates = { ...player };

      if (potentialGap > 0 && Math.random() < 0.4 * ageFactor) {
        const attrs = focus === 'general' ? ['pace', 'shooting', 'passing', 'defending', 'physical'] : [focus];
        const attr = attrs[Math.floor(Math.random() * attrs.length)];
        if (player[attr] < 99) {
          updates[attr] = player[attr] + 1;
          stmts.push({ sql: `UPDATE players SET ${attr} = ${attr} + 1 WHERE id = ?`, args: [player.id] });
          improved = true;
        }
      }

      const newOvr = calculateOVR(player.position, updates);
      const fitnessDrop = Math.floor(Math.random() * 8) + 5;
      stmts.push({ sql: 'UPDATE players SET ovr = ? WHERE id = ?', args: [newOvr, player.id] });
      stmts.push({ sql: 'UPDATE players SET fitness = MAX(40, fitness - ?) WHERE id = ?', args: [fitnessDrop, player.id] });

      if (improved) results.push({ name: `${player.first_name} ${player.last_name}`, attr: focus });
    }

    stmts.push({ sql: 'UPDATE clubs SET balance = balance - ? WHERE id = ?', args: [trainingCost, req.user.club_id] });
    if (stmts.length > 0) await db.batch(stmts);

    res.json({ message: `Squad training complete. ${results.length} players improved.`, improved: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Match Routes ────────────────────────────────────────────────────────────
app.get('/api/matches/current', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const season = await getSeason();
    const matches = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.matchday = ? ORDER BY m.id`,
      args: [season.current_matchday]
    })).rows;

    const userMatch = matches.find(m => m.home_team_id === req.user.club_id || m.away_team_id === req.user.club_id);
    res.json({ matchday: season.current_matchday, matches, userMatch, status: season.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/matches/simulate', auth, requireClub, async (req, res) => {
  try {
    const season = await getSeason();
    if (season.status === 'finished') return res.status(400).json({ error: 'Season is finished' });

    const db = getDb();
    const unsimulated = (await db.execute({ sql: 'SELECT COUNT(*) as count FROM matches WHERE matchday = ? AND simulated = 0', args: [season.current_matchday] })).rows[0];
    if (unsimulated.count === 0) return res.status(400).json({ error: 'Current matchday already simulated. Advance to next matchday.' });

    const results = await simulateMatchday(season.current_matchday);
    await aiTransferActions();

    const userResult = results.find(r => r.home_team_id === req.user.club_id || r.away_team_id === req.user.club_id);
    const standings = await getStandings();

    if (userResult) {
      const isHome = userResult.home_team_id === req.user.club_id;
      const userGoals = isHome ? userResult.homeGoals : userResult.awayGoals;
      const oppGoals = isHome ? userResult.awayGoals : userResult.homeGoals;
      const opponent = (await db.execute({ sql: 'SELECT name FROM clubs WHERE id = ?', args: [isHome ? userResult.away_team_id : userResult.home_team_id] })).rows[0];

      let resultType, title, message;
      if (userGoals > oppGoals) { resultType = 'match_win'; title = 'Victory!'; message = `You defeated ${opponent.name} ${userGoals}-${oppGoals}`; }
      else if (userGoals < oppGoals) { resultType = 'match_loss'; title = 'Defeat'; message = `You lost to ${opponent.name} ${userGoals}-${oppGoals}`; }
      else { resultType = 'match_draw'; title = 'Draw'; message = `You drew with ${opponent.name} ${userGoals}-${oppGoals}`; }

      await createNotification(req.user.id, resultType, title, message);
    }

    const enriched = await Promise.all(results.map(async r => {
      const home = (await db.execute({ sql: 'SELECT name, short_name FROM clubs WHERE id = ?', args: [r.home_team_id] })).rows[0];
      const away = (await db.execute({ sql: 'SELECT name, short_name FROM clubs WHERE id = ?', args: [r.away_team_id] })).rows[0];
      return { ...r, home_name: home.name, home_short: home.short_name, away_name: away.name, away_short: away.short_name };
    }));

    res.json({ matchday: season.current_matchday, results: enriched, userResult: userResult ? { ...userResult, isHome: userResult.home_team_id === req.user.club_id } : null, standings, canAdvance: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/matches/advance', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const success = await advanceMatchday();
    if (!success) return res.json({ message: 'Season finished!', finished: true, standings: await getStandings() });

    const totalWages = (await db.execute({ sql: 'SELECT SUM(salary) as total FROM players WHERE club_id = ?', args: [req.user.club_id] })).rows[0].total || 0;
    await db.execute({ sql: 'UPDATE clubs SET balance = balance - ? WHERE id = ?', args: [totalWages, req.user.club_id] });
    await db.execute({ sql: 'UPDATE players SET fitness = MIN(100, fitness + (ABS(RANDOM()) % 10) + 10) WHERE club_id = ?', args: [req.user.club_id] });

    const season = await getSeason();
    res.json({ message: `Advanced to matchday ${season.current_matchday}`, matchday: season.current_matchday, season });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/matches/history', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const matches = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?) ORDER BY m.matchday DESC`,
      args: [req.user.club_id, req.user.club_id]
    })).rows;
    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/matches/:matchday', auth, async (req, res) => {
  try {
    const db = getDb();
    const matchday = parseInt(req.params.matchday);
    const matches = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.matchday = ? ORDER BY m.id`,
      args: [matchday]
    })).rows;
    res.json({ matchday, matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── League Routes ───────────────────────────────────────────────────────────
app.get('/api/league', auth, async (req, res) => {
  try {
    const standings = await getStandings();
    const season = await getSeason();
    res.json({ standings, season });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/league/fixtures', auth, async (req, res) => {
  try {
    const db = getDb();
    const { matchday } = req.query;
    const season = await getSeason();

    if (matchday) {
      const md = parseInt(matchday);
      const matches = (await db.execute({
        sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
               c2.name as away_name, c2.short_name as away_short
              FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
              WHERE m.matchday = ? ORDER BY m.id`,
        args: [md]
      })).rows;
      return res.json({ matchday: md, matches });
    }

    const allMatches = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            ORDER BY m.matchday, m.id`
    })).rows;

    const grouped = {};
    for (const m of allMatches) {
      if (!grouped[m.matchday]) grouped[m.matchday] = [];
      grouped[m.matchday].push(m);
    }

    res.json({ currentMatchday: season.current_matchday, matchdays: grouped, totalMatchdays: season.total_matchdays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Finances ────────────────────────────────────────────────────────────────
app.get('/api/finances', auth, requireClub, async (req, res) => {
  try {
    const db = getDb();
    const club = (await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [req.user.club_id] })).rows[0];
    const players = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ? ORDER BY salary DESC', args: [req.user.club_id] })).rows;
    const totalWages = players.reduce((sum, p) => sum + p.salary, 0);
    const totalValue = players.reduce((sum, p) => sum + p.value, 0);

    const recentTransfers = (await db.execute({
      sql: `SELECT t.*, p.first_name, p.last_name FROM transfers t
            JOIN players p ON t.player_id = p.id
            WHERE t.from_club_id = ? OR t.to_club_id = ? ORDER BY t.matchday DESC LIMIT 20`,
      args: [req.user.club_id, req.user.club_id]
    })).rows;

    res.json({ club: { balance: club.balance, transfer_budget: club.transfer_budget, wage_budget: club.wage_budget }, totalWages, totalValue, wageBill: totalWages, players, recentTransfers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Player Profile ──────────────────────────────────────────────────────────
app.get('/api/players/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [req.params.id] })).rows[0];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const club = player.club_id ? (await db.execute({ sql: 'SELECT name FROM clubs WHERE id = ?', args: [player.club_id] })).rows[0] : null;
    res.json({ player, clubName: club?.name || 'Free Agent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Club Profile ────────────────────────────────────────────────────────────
app.get('/api/clubs/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const club = (await db.execute({ sql: 'SELECT * FROM clubs WHERE id = ?', args: [req.params.id] })).rows[0];
    if (!club) return res.status(404).json({ error: 'Club not found' });

    const squad = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ? ORDER BY ovr DESC', args: [club.id] })).rows;
    const totalValue = squad.reduce((sum, p) => sum + p.value, 0);
    const totalWages = squad.reduce((sum, p) => sum + p.salary, 0);
    const avgOvr = squad.length > 0 ? squad.reduce((sum, p) => sum + p.ovr, 0) / squad.length : 0;

    const recentMatches = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?) ORDER BY m.matchday DESC LIMIT 5`,
      args: [club.id, club.id]
    })).rows;

    const standings = await getStandings();
    const standing = standings.find(s => s.club_id === club.id);

    res.json({ club, squad, totalValue, totalWages, avgOvr: Math.round(avgOvr), recentMatches, standing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Leaderboards ────────────────────────────────────────────────────────────
app.get('/api/leaderboards', auth, async (req, res) => {
  try {
    const db = getDb();
    const topScorers = (await db.execute({ sql: 'SELECT p.*, c.name as club_name FROM players p JOIN clubs c ON p.club_id = c.id WHERE p.goals > 0 ORDER BY p.goals DESC LIMIT 20' })).rows;
    const topAssists = (await db.execute({ sql: 'SELECT p.*, c.name as club_name FROM players p JOIN clubs c ON p.club_id = c.id WHERE p.assists > 0 ORDER BY p.assists DESC LIMIT 20' })).rows;
    const highestOvr = (await db.execute({ sql: 'SELECT p.*, c.name as club_name FROM players p JOIN clubs c ON p.club_id = c.id ORDER BY p.ovr DESC LIMIT 20' })).rows;
    const mostValuable = (await db.execute({ sql: 'SELECT p.*, c.name as club_name FROM players p JOIN clubs c ON p.club_id = c.id ORDER BY p.value DESC LIMIT 20' })).rows;
    res.json({ topScorers, topAssists, highestOvr, mostValuable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Match Report ────────────────────────────────────────────────────────────
app.get('/api/matches/report/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const match = (await db.execute({
      sql: `SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
            FROM matches m JOIN clubs c1 ON m.home_team_id = c1.id JOIN clubs c2 ON m.away_team_id = c2.id
            WHERE m.id = ?`,
      args: [req.params.id]
    })).rows[0];
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const events = match.events ? JSON.parse(match.events) : [];
    const playerRatings = {};

    for (const event of events) {
      if (!event.player_id) continue;
      if (!playerRatings[event.player_id]) playerRatings[event.player_id] = { name: event.player, team: event.team, goals: 0, assists: 0, yellowCards: 0, redCards: 0, rating: 6.0 };
      const pr = playerRatings[event.player_id];
      if (event.type === 'goal') { pr.goals++; pr.rating += 1.0; }
      else if (event.type === 'assist') { pr.assists++; pr.rating += 0.5; }
      else if (event.type === 'yellow') { pr.yellowCards++; pr.rating -= 0.5; }
      else if (event.type === 'red') { pr.redCards++; pr.rating -= 2.0; }
    }

    for (const event of events) {
      if (event.type === 'goal' && event.assist_id) {
        if (!playerRatings[event.assist_id]) playerRatings[event.assist_id] = { name: event.assist, team: event.team, goals: 0, assists: 0, yellowCards: 0, redCards: 0, rating: 6.0 };
        playerRatings[event.assist_id].assists++;
        playerRatings[event.assist_id].rating += 0.5;
      }
    }

    res.json({
      match, events,
      playerRatings: Object.values(playerRatings).sort((a, b) => b.rating - a.rating),
      stats: {
        home: { possession: match.home_possession, shots: match.home_shots, shotsOnTarget: match.home_shots_on_target, corners: match.home_corners, fouls: match.home_fouls },
        away: { possession: match.away_possession, shots: match.away_shots, shotsOnTarget: match.away_shots_on_target, corners: match.away_corners, fouls: match.away_fouls },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notifications ───────────────────────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const db = getDb();
    const notifications = (await db.execute({ sql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', args: [req.user.id] })).rows;
    const unreadCount = notifications.filter(n => !n.read).length;
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/:id/read', auth, async (req, res) => {
  try {
    const db = getDb();
    await db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', args: [req.params.id, req.user.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  try {
    const db = getDb();
    await db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE user_id = ?', args: [req.user.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function createNotification(userId, type, title, message) {
  const db = getDb();
  await db.execute({ sql: 'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)', args: [userId, type, title, message] });
}

// ─── SPA Fallback ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Initialize and Export (Vercel-compatible) ────────────────────────────────
let initialized = false;
const originalListen = app.listen.bind(app);

async function bootstrap() {
  if (!initialized) {
    try {
      await initializeGame();
      initialized = true;
    } catch (err) {
      console.error('initializeGame error:', err.message);
    }
  }
}

// For local dev
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  bootstrap().then(() => {
    originalListen(PORT, () => console.log(`Pitch Manager running on http://localhost:${PORT}`));
  });
}

// For Vercel: wrap with init guard
module.exports = async (req, res) => {
  await bootstrap();
  app(req, res);
};
