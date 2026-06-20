const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');
const { generatePlayer, insertPlayer, generateTransferMarket } = require('./player-generator');
const { simulateMatchday, getTeamStrength } = require('./match-simulator');
const {
  initializeGame, createUserClub, getStandings, getSeason,
  advanceMatchday, getCurrentMatchdayFixtures, aiTransferActions
} = require('./league-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pitch-manager-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper function for formatting money
function formatMoney(n) {
  if (n == null) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n < 0 ? '-' : '') + '$' + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return (n < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(0) + 'K';
  return '$' + n.toLocaleString();
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = db.prepare('SELECT id, username, email, club_id FROM users WHERE id = ?').get(decoded.id);
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
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.status(400).json({ error: 'Username or email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)').run(username, email, hash);
  const token = jwt.sign({ id: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });

  res.json({ token, user: { id: result.lastInsertRowid, username, email, club_id: null } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, club_id: user.club_id } });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// ─── Club Routes ─────────────────────────────────────────────────────────────
app.post('/api/club/create', auth, (req, res) => {
  if (req.user.club_id) return res.status(400).json({ error: 'You already have a club' });
  const { name, stadium, city } = req.body;
  if (!name || !stadium || !city) return res.status(400).json({ error: 'All fields are required' });

  try {
    const clubId = createUserClub(req.user.id, name, stadium, city);
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    res.json({ club });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/club', auth, requireClub, (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.user.club_id);
  const squadSize = db.prepare('SELECT COUNT(*) as count FROM players WHERE club_id = ?').get(req.user.club_id).count;
  const totalWages = db.prepare('SELECT SUM(salary) as total FROM players WHERE club_id = ?').get(req.user.club_id).total || 0;
  res.json({ club, squadSize, totalWages });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, requireClub, (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.user.club_id);
  const season = getSeason();
  const standings = getStandings();
  const userStanding = standings.find(s => s.club_id === req.user.club_id);

  // Next match
  const nextMatch = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.matchday = ? AND (m.home_team_id = ? OR m.away_team_id = ?)
    AND m.simulated = 0
    LIMIT 1
  `).get(season.current_matchday, req.user.club_id, req.user.club_id);

  // Last match result
  const lastMatch = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?)
    ORDER BY m.played_at DESC LIMIT 1
  `).all(req.user.club_id, req.user.club_id);

  // Squad summary
  const squadSummary = db.prepare(`
    SELECT position, COUNT(*) as count, ROUND(AVG(ovr), 1) as avg_ovr
    FROM players WHERE club_id = ? GROUP BY position
  `).all(req.user.club_id);

  // Finances
  const totalWages = db.prepare('SELECT SUM(salary) as total FROM players WHERE club_id = ?').get(req.user.club_id).total || 0;

  res.json({
    club,
    season,
    standing: userStanding,
    nextMatch,
    lastMatch: lastMatch[0] || null,
    squadSummary,
    totalWages,
  });
});

// ─── Squad Routes ────────────────────────────────────────────────────────────
app.get('/api/squad', auth, requireClub, (req, res) => {
  const { sort = 'ovr', order = 'desc', position } = req.query;
  const allowedSorts = ['ovr', 'age', 'value', 'salary', 'fitness', 'morale', 'position', 'potential', 'pace', 'shooting', 'passing', 'defending', 'physical', 'goalkeeping'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'ovr';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  let query = 'SELECT * FROM players WHERE club_id = ?';
  const params = [req.user.club_id];

  if (position) {
    query += ' AND position = ?';
    params.push(position);
  }

  query += ` ORDER BY ${sortCol} ${sortOrder}`;

  const players = db.prepare(query).all(...params);
  res.json({ players });
});

app.get('/api/squad/:id', auth, requireClub, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({ player });
});

// ─── Transfer Market ─────────────────────────────────────────────────────────
app.get('/api/transfers/market', auth, requireClub, (req, res) => {
  const { sort = 'ovr', order = 'desc', position, maxPrice } = req.query;
  const allowedSorts = ['ovr', 'age', 'value', 'asking_price', 'potential', 'pace', 'shooting', 'passing', 'defending', 'physical'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'ovr';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  let query = 'SELECT * FROM players WHERE club_id = 0 AND is_listed = 1';
  const params = [];

  if (position) { query += ' AND position = ?'; params.push(position); }
  if (maxPrice) { query += ' AND asking_price <= ?'; params.push(parseInt(maxPrice)); }

  query += ` ORDER BY ${sortCol} ${sortOrder}`;

  const players = db.prepare(query).all(...params);
  const club = db.prepare('SELECT transfer_budget FROM clubs WHERE id = ?').get(req.user.club_id);
  res.json({ players, budget: club.transfer_budget });
});

app.post('/api/transfers/buy/:playerId', auth, requireClub, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND club_id = 0 AND is_listed = 1').get(req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not available on transfer market' });

  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.user.club_id);
  if (club.transfer_budget < player.asking_price) {
    return res.status(400).json({ error: 'Insufficient transfer budget' });
  }

  const squadCount = db.prepare('SELECT COUNT(*) as count FROM players WHERE club_id = ?').get(req.user.club_id).count;
  if (squadCount >= 30) {
    return res.status(400).json({ error: 'Squad is full (max 30 players)' });
  }

  const season = getSeason();

  db.transaction(() => {
    db.prepare('UPDATE players SET club_id = ?, is_listed = 0, asking_price = 0 WHERE id = ?')
      .run(req.user.club_id, player.id);
    db.prepare('UPDATE clubs SET transfer_budget = transfer_budget - ?, balance = balance - ? WHERE id = ?')
      .run(player.asking_price, player.asking_price, req.user.club_id);
    db.prepare('INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday) VALUES (?, 0, ?, ?, ?)')
      .run(player.id, req.user.club_id, player.asking_price, season.current_matchday);
  })();

  // Create notification
  createNotification(
    req.user.id,
    'transfer_in',
    'Player Signed',
    `${player.first_name} ${player.last_name} has joined your club for ${formatMoney(player.asking_price)}`
  );

  res.json({ message: `Successfully signed ${player.first_name} ${player.last_name}`, player });
});

app.get('/api/transfers/listed', auth, requireClub, (req, res) => {
  const players = db.prepare('SELECT * FROM players WHERE club_id = ? AND is_listed = 1').all(req.user.club_id);
  res.json({ players });
});

app.post('/api/transfers/sell/:playerId', auth, requireClub, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND club_id = ?').get(req.params.playerId, req.user.club_id);
  if (!player) return res.status(404).json({ error: 'Player not in your squad' });

  const squadCount = db.prepare('SELECT COUNT(*) as count FROM players WHERE club_id = ?').get(req.user.club_id).count;
  if (squadCount <= 16) {
    return res.status(400).json({ error: 'Cannot sell: minimum squad size is 16' });
  }

  const season = getSeason();
  const sellPrice = Math.round(player.value * 0.9);

  db.transaction(() => {
    // Move to transfer market (club_id = 0)
    db.prepare('UPDATE players SET club_id = 0, is_listed = 1, asking_price = ? WHERE id = ?')
      .run(player.asking_price || Math.round(player.value * 1.1), player.id);
    db.prepare('UPDATE clubs SET transfer_budget = transfer_budget + ?, balance = balance + ? WHERE id = ?')
      .run(sellPrice, sellPrice, req.user.club_id);
    db.prepare('INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday) VALUES (?, ?, 0, ?, ?)')
      .run(player.id, req.user.club_id, sellPrice, season.current_matchday);
  })();

  res.json({ message: `${player.first_name} ${player.last_name} listed for sale. Received $${sellPrice.toLocaleString()} compensation.` });
});

// ─── Training ────────────────────────────────────────────────────────────────
app.get('/api/training', auth, requireClub, (req, res) => {
  const players = db.prepare(`
    SELECT id, first_name, last_name, age, position, ovr, potential, fitness, morale
    FROM players WHERE club_id = ?
    ORDER BY ovr DESC
  `).all(req.user.club_id);
  res.json({ players });
});

app.post('/api/training/:playerId', auth, requireClub, (req, res) => {
  const { focus } = req.body; // pace, shooting, passing, defending, physical, general
  const player = db.prepare('SELECT * FROM players WHERE id = ? AND club_id = ?').get(req.params.playerId, req.user.club_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  if (player.fitness < 30) {
    return res.status(400).json({ error: 'Player fitness too low for training. Wait for recovery.' });
  }

  const trainingCost = 10000;
  const club = db.prepare('SELECT balance FROM clubs WHERE id = ?').get(req.user.club_id);
  if (club.balance < trainingCost) {
    return res.status(400).json({ error: 'Insufficient funds for training' });
  }

  // Calculate improvement
  let improvement = 0;
  const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
  const potentialGap = player.potential - player.ovr;

  if (potentialGap > 0) {
    improvement = Math.ceil(Math.random() * 2 * ageFactor);
    improvement = Math.min(improvement, Math.ceil(potentialGap / 5));
  } else {
    improvement = Math.random() < 0.2 ? 1 : 0;
  }

  const updates = {};
  const focusAttrs = focus === 'general'
    ? ['pace', 'shooting', 'passing', 'defending', 'physical']
    : [focus];

  db.transaction(() => {
    for (const attr of focusAttrs) {
      if (attr === 'general') continue;
      const gain = attr === focus ? improvement : (improvement > 0 && Math.random() < 0.3 ? 1 : 0);
      if (gain > 0 && player[attr] < 99) {
        const newVal = Math.min(99, player[attr] + gain);
        updates[attr] = newVal;
        db.prepare(`UPDATE players SET ${attr} = ? WHERE id = ?`).run(newVal, player.id);
      }
    }

    // Recalculate OVR
    const { calculateOVR } = require('./player-generator');
    const updatedPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
    const newOvr = calculateOVR(player.position, updatedPlayer);
    db.prepare('UPDATE players SET ovr = ? WHERE id = ?').run(newOvr, player.id);

    // Reduce fitness
    db.prepare('UPDATE players SET fitness = MAX(40, fitness - ?) WHERE id = ?')
      .run(Math.floor(Math.random() * 8) + 5, player.id);

    // Cost
    db.prepare('UPDATE clubs SET balance = balance - ? WHERE id = ?')
      .run(trainingCost, req.user.club_id);
  })();

  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
  res.json({
    message: `Training complete for ${player.first_name} ${player.last_name}`,
    player: updated,
    improvements: updates,
  });
});

// Batch training
app.post('/api/training/batch', auth, requireClub, (req, res) => {
  const { focus } = req.body;
  const players = db.prepare('SELECT * FROM players WHERE club_id = ? AND fitness >= 30').all(req.user.club_id);
  const results = [];
  const trainingCost = 10000 * players.length;

  const club = db.prepare('SELECT balance FROM clubs WHERE id = ?').get(req.user.club_id);
  if (club.balance < trainingCost) {
    return res.status(400).json({ error: `Insufficient funds. Need $${trainingCost.toLocaleString()} for full squad training.` });
  }

  const { calculateOVR } = require('./player-generator');

  db.transaction(() => {
    for (const player of players) {
      const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
      const potentialGap = player.potential - player.ovr;
      let improved = false;

      if (potentialGap > 0 && Math.random() < 0.4 * ageFactor) {
        const attrs = focus === 'general'
          ? ['pace', 'shooting', 'passing', 'defending', 'physical']
          : [focus];
        const attr = attrs[Math.floor(Math.random() * attrs.length)];
        if (player[attr] < 99) {
          db.prepare(`UPDATE players SET ${attr} = ${attr} + 1 WHERE id = ?`).run(player.id);
          improved = true;
        }
      }

      const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
      const newOvr = calculateOVR(player.position, updated);
      db.prepare('UPDATE players SET ovr = ? WHERE id = ?').run(newOvr, player.id);
      db.prepare('UPDATE players SET fitness = MAX(40, fitness - ?) WHERE id = ?')
        .run(Math.floor(Math.random() * 8) + 5, player.id);

      if (improved) results.push({ name: `${player.first_name} ${player.last_name}`, attr: focus });
    }

    db.prepare('UPDATE clubs SET balance = balance - ? WHERE id = ?').run(trainingCost, req.user.club_id);
  })();

  res.json({ message: `Squad training complete. ${results.length} players improved.`, improved: results });
});

// ─── Match Routes ────────────────────────────────────────────────────────────
app.get('/api/matches/current', auth, requireClub, (req, res) => {
  const season = getSeason();
  const matches = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.matchday = ?
    ORDER BY m.id
  `).all(season.current_matchday);

  const userMatch = matches.find(m =>
    m.home_team_id === req.user.club_id || m.away_team_id === req.user.club_id
  );

  res.json({ matchday: season.current_matchday, matches, userMatch, status: season.status });
});

app.post('/api/matches/simulate', auth, requireClub, (req, res) => {
  const season = getSeason();
  if (season.status === 'finished') {
    return res.status(400).json({ error: 'Season is finished' });
  }

  // Check if current matchday is already simulated
  const unsimulated = db.prepare(
    'SELECT COUNT(*) as count FROM matches WHERE matchday = ? AND simulated = 0'
  ).get(season.current_matchday);

  if (unsimulated.count === 0) {
    return res.status(400).json({ error: 'Current matchday already simulated. Advance to next matchday.' });
  }

  // Simulate all matches for this matchday
  const results = simulateMatchday(season.current_matchday);

  // AI transfer actions after matchday
  aiTransferActions();

  // Get user's match result
  const userResult = results.find(r =>
    r.home_team_id === req.user.club_id || r.away_team_id === req.user.club_id
  );

  // Get updated standings
  const standings = getStandings();

  // Create notification for user's match result
  if (userResult) {
    const isHome = userResult.home_team_id === req.user.club_id;
    const userGoals = isHome ? userResult.homeGoals : userResult.awayGoals;
    const oppGoals = isHome ? userResult.awayGoals : userResult.homeGoals;
    const opponent = db.prepare('SELECT name FROM clubs WHERE id = ?').get(
      isHome ? userResult.away_team_id : userResult.home_team_id
    );

    let resultType, title, message;
    if (userGoals > oppGoals) {
      resultType = 'match_win';
      title = 'Victory!';
      message = `You defeated ${opponent.name} ${userGoals}-${oppGoals}`;
    } else if (userGoals < oppGoals) {
      resultType = 'match_loss';
      title = 'Defeat';
      message = `You lost to ${opponent.name} ${userGoals}-${oppGoals}`;
    } else {
      resultType = 'match_draw';
      title = 'Draw';
      message = `You drew with ${opponent.name} ${userGoals}-${oppGoals}`;
    }

    createNotification(req.user.id, resultType, title, message);
  }

  res.json({
    matchday: season.current_matchday,
    results: results.map(r => {
      const home = db.prepare('SELECT name, short_name FROM clubs WHERE id = ?').get(r.home_team_id);
      const away = db.prepare('SELECT name, short_name FROM clubs WHERE id = ?').get(r.away_team_id);
      return { ...r, home_name: home.name, home_short: home.short_name, away_name: away.name, away_short: away.short_name };
    }),
    userResult: userResult ? {
      ...userResult,
      isHome: userResult.home_team_id === req.user.club_id,
    } : null,
    standings,
    canAdvance: true,
  });
});

app.post('/api/matches/advance', auth, requireClub, (req, res) => {
  const success = advanceMatchday();
  if (!success) {
    return res.json({ message: 'Season finished!', finished: true, standings: getStandings() });
  }

  // Weekly wage deduction
  const totalWages = db.prepare('SELECT SUM(salary) as total FROM players WHERE club_id = ?').get(req.user.club_id).total || 0;
  db.prepare('UPDATE clubs SET balance = balance - ? WHERE id = ?').run(totalWages, req.user.club_id);

  // Recover some fitness
  db.prepare('UPDATE players SET fitness = MIN(100, fitness + RANDOM() % 10 + 10) WHERE club_id = ?').run(req.user.club_id);

  const season = getSeason();
  res.json({ message: `Advanced to matchday ${season.current_matchday}`, matchday: season.current_matchday, season });
});

app.get('/api/matches/history', auth, requireClub, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?)
    ORDER BY m.matchday DESC
  `).all(req.user.club_id, req.user.club_id);

  res.json({ matches });
});

app.get('/api/matches/:matchday', auth, (req, res) => {
  const matchday = parseInt(req.params.matchday);
  const matches = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.matchday = ?
    ORDER BY m.id
  `).all(matchday);

  res.json({ matchday, matches });
});

// ─── League Routes ───────────────────────────────────────────────────────────
app.get('/api/league', auth, (req, res) => {
  const standings = getStandings();
  const season = getSeason();
  res.json({ standings, season });
});

app.get('/api/league/fixtures', auth, (req, res) => {
  const { matchday } = req.query;
  const season = getSeason();

  if (matchday) {
    const md = parseInt(matchday);
    const matches = db.prepare(`
      SELECT m.*, c1.name as home_name, c1.short_name as home_short,
             c2.name as away_name, c2.short_name as away_short
      FROM matches m
      JOIN clubs c1 ON m.home_team_id = c1.id
      JOIN clubs c2 ON m.away_team_id = c2.id
      WHERE m.matchday = ?
      ORDER BY m.id
    `).all(md);
    return res.json({ matchday: md, matches });
  }

  // Return all matchdays grouped
  const allMatches = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    ORDER BY m.matchday, m.id
  `).all();

  const grouped = {};
  for (const m of allMatches) {
    if (!grouped[m.matchday]) grouped[m.matchday] = [];
    grouped[m.matchday].push(m);
  }

  res.json({ currentMatchday: season.current_matchday, matchdays: grouped, totalMatchdays: season.total_matchdays });
});

// ─── Finances ────────────────────────────────────────────────────────────────
app.get('/api/finances', auth, requireClub, (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.user.club_id);
  const players = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY salary DESC').all(req.user.club_id);
  const totalWages = players.reduce((sum, p) => sum + p.salary, 0);
  const totalValue = players.reduce((sum, p) => sum + p.value, 0);

  const recentTransfers = db.prepare(`
    SELECT t.*, p.first_name, p.last_name
    FROM transfers t
    JOIN players p ON t.player_id = p.id
    WHERE t.from_club_id = ? OR t.to_club_id = ?
    ORDER BY t.matchday DESC LIMIT 20
  `).all(req.user.club_id, req.user.club_id);

  res.json({
    club: {
      balance: club.balance,
      transfer_budget: club.transfer_budget,
      wage_budget: club.wage_budget,
    },
    totalWages,
    totalValue,
    wageBill: totalWages,
    players,
    recentTransfers,
  });
});

// ─── Player Profile ──────────────────────────────────────────────────────────
app.get('/api/players/:id', auth, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(player.club_id);

  res.json({
    player,
    clubName: club?.name || 'Free Agent',
  });
});

// ─── Club Profile ────────────────────────────────────────────────────────────
app.get('/api/clubs/:id', auth, (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).json({ error: 'Club not found' });

  const squad = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY ovr DESC').all(club.id);
  const totalValue = squad.reduce((sum, p) => sum + p.value, 0);
  const totalWages = squad.reduce((sum, p) => sum + p.salary, 0);
  const avgOvr = squad.length > 0 ? squad.reduce((sum, p) => sum + p.ovr, 0) / squad.length : 0;

  // Recent matches
  const recentMatches = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.simulated = 1 AND (m.home_team_id = ? OR m.away_team_id = ?)
    ORDER BY m.matchday DESC LIMIT 5
  `).all(club.id, club.id);

  // League position
  const standings = getStandings();
  const standing = standings.find(s => s.club_id === club.id);

  res.json({
    club,
    squad,
    totalValue,
    totalWages,
    avgOvr: Math.round(avgOvr),
    recentMatches,
    standing,
  });
});

// ─── Leaderboards ────────────────────────────────────────────────────────────
app.get('/api/leaderboards', auth, (req, res) => {
  const topScorers = db.prepare(`
    SELECT p.*, c.name as club_name
    FROM players p
    JOIN clubs c ON p.club_id = c.id
    WHERE p.goals > 0
    ORDER BY p.goals DESC
    LIMIT 20
  `).all();

  const topAssists = db.prepare(`
    SELECT p.*, c.name as club_name
    FROM players p
    JOIN clubs c ON p.club_id = c.id
    WHERE p.assists > 0
    ORDER BY p.assists DESC
    LIMIT 20
  `).all();

  const highestOvr = db.prepare(`
    SELECT p.*, c.name as club_name
    FROM players p
    JOIN clubs c ON p.club_id = c.id
    ORDER BY p.ovr DESC
    LIMIT 20
  `).all();

  const mostValuable = db.prepare(`
    SELECT p.*, c.name as club_name
    FROM players p
    JOIN clubs c ON p.club_id = c.id
    ORDER BY p.value DESC
    LIMIT 20
  `).all();

  res.json({
    topScorers,
    topAssists,
    highestOvr,
    mostValuable,
  });
});

// ─── Match Report ────────────────────────────────────────────────────────────
app.get('/api/matches/report/:id', auth, (req, res) => {
  const match = db.prepare(`
    SELECT m.*, c1.name as home_name, c1.short_name as home_short,
           c2.name as away_name, c2.short_name as away_short
    FROM matches m
    JOIN clubs c1 ON m.home_team_id = c1.id
    JOIN clubs c2 ON m.away_team_id = c2.id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  const events = match.events ? JSON.parse(match.events) : [];

  // Get player ratings (simplified based on events)
  const playerRatings = {};
  for (const event of events) {
    if (!event.player_id) continue;
    if (!playerRatings[event.player_id]) {
      playerRatings[event.player_id] = {
        name: event.player,
        team: event.team,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        rating: 6.0,
      };
    }
    const pr = playerRatings[event.player_id];
    if (event.type === 'goal') {
      pr.goals++;
      pr.rating += 1.0;
    } else if (event.type === 'assist') {
      pr.assists++;
      pr.rating += 0.5;
    } else if (event.type === 'yellow') {
      pr.yellowCards++;
      pr.rating -= 0.5;
    } else if (event.type === 'red') {
      pr.redCards++;
      pr.rating -= 2.0;
    }
  }

  // Handle assists separately
  for (const event of events) {
    if (event.type === 'goal' && event.assist_id) {
      if (!playerRatings[event.assist_id]) {
        playerRatings[event.assist_id] = {
          name: event.assist,
          team: event.team,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
          rating: 6.0,
        };
      }
      playerRatings[event.assist_id].assists++;
      playerRatings[event.assist_id].rating += 0.5;
    }
  }

  res.json({
    match,
    events,
    playerRatings: Object.values(playerRatings).sort((a, b) => b.rating - a.rating),
    stats: {
      home: {
        possession: match.home_possession,
        shots: match.home_shots,
        shotsOnTarget: match.home_shots_on_target,
        corners: match.home_corners,
        fouls: match.home_fouls,
      },
      away: {
        possession: match.away_possession,
        shots: match.away_shots,
        shotsOnTarget: match.away_shots_on_target,
        corners: match.away_corners,
        fouls: match.away_fouls,
      },
    },
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.id);

  const unreadCount = notifications.filter(n => !n.read).length;

  res.json({ notifications, unreadCount });
});

app.post('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

// Helper function to create notification
function createNotification(userId, type, title, message) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(userId, type, title, message);
}

// ─── Initialize Game ─────────────────────────────────────────────────────────
initializeGame();

// ─── SPA Fallback ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pitch Manager running on http://localhost:${PORT}`);
});
