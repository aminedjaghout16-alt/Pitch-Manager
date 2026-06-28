const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { query, queryOne, queryAll, transaction, ensureSchema, healthCheck } = require('./db');
const { generatePlayer, insertPlayer, generateTransferMarket, calculateOVR, calculateValue, calculateSalary } = require('./player-generator');
const { simulateMatchday, getTeamStrength } = require('./match-simulator');
const { initializeGame, createUserClub, getStandings, getSeason, advanceMatchday, getCurrentMatchdayFixtures, aiTransferActions, startAutoSimulation } = require('./league-manager');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'pitch-manager-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Club Name Cache ──────────────────────────────────────────────────────────
const clubNameCache = {};
async function resolveClubName(clubId) {
  if(clubNameCache[clubId]) return clubNameCache[clubId];
  const row = await queryOne('SELECT name, short_name FROM clubs WHERE id=$1', [clubId]);
  const name = row?.name || 'Unknown Club';
  const shortName = row?.short_name || 'UNK';
  clubNameCache[clubId] = { name, shortName };
  return { name, shortName };
}

async function enrichMatch(m) {
  const [home, away] = await Promise.all([
    resolveClubName(m.home_team_id),
    resolveClubName(m.away_team_id),
  ]);
  return {
    id: m.id,
    matchday: m.matchday,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeName: home.name,
    homeShort: home.shortName,
    awayName: away.name,
    awayShort: away.shortName,
    homeGoals: m.home_goals,
    awayGoals: m.away_goals,
    simulated: m.simulated,
    events: m.events || [],
    playedAt: m.played_at,
  };
}

function formatMoney(n) {
  if(n==null) return '$0';
  const abs=Math.abs(n);
  if(abs>=1000000) return (n<0?'-':'')+'$'+(abs/1000000).toFixed(1)+'M';
  if(abs>=1000) return (n<0?'-':'')+'$'+(abs/1000).toFixed(0)+'K';
  return '$'+n.toLocaleString();
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ','');
  if(!token) return res.status(401).json({error:'Authentication required'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [decoded.id]);
    if(!user) return res.status(401).json({error:'User not found'});
    req.user = { id: user.id, username: user.username, email: user.email, clubId: user.club_id };
    next();
  } catch { return res.status(401).json({error:'Invalid token'}); }
}

function requireClub(req, res, next) {
  if(!req.user.clubId) return res.status(400).json({error:'You must create a club first'});
  next();
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async(req, res) => {
  try {
    const { username, email, password } = req.body;
    if(!username || !email || !password) return res.status(400).json({error:'All fields required'});
    if(password.length < 6) return res.status(400).json({error:'Password must be at least 6 characters'});
    
    const existing = await queryOne('SELECT id FROM users WHERE username=$1 OR email=$2', [username, email]);
    if(existing) return res.status(400).json({error:'Username or email already exists'});
    
    const hash = bcrypt.hashSync(password, 10);
    const result = await query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, email, hash]
    );
    const userId = result.rows[0].id;
    const token = jwt.sign({id: userId}, JWT_SECRET, {expiresIn:'30d'});
    res.json({token, user:{id:userId, username, email, clubId:null}});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/auth/login', async(req, res) => {
  try {
    const { username, password } = req.body;
    const user = await queryOne('SELECT * FROM users WHERE username=$1 OR email=$1', [username]);
    if(!user) return res.status(401).json({error:'Invalid credentials'});
    if(!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({error:'Invalid credentials'});
    const token = jwt.sign({id: user.id}, JWT_SECRET, {expiresIn:'30d'});
    res.json({token, user:{id:user.id, username:user.username, email:user.email, clubId:user.club_id}});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({user:{id:req.user.id, username:req.user.username, email:req.user.email, clubId:req.user.clubId}});
});

// ─── Club Routes ──────────────────────────────────────────────────────────────
app.post('/api/club/create', auth, async(req, res) => {
  if(req.user.clubId) return res.status(400).json({error:'You already have a club'});
  const { name, stadium, city } = req.body;
  if(!name || !stadium || !city) return res.status(400).json({error:'All fields required'});
  try {
    const clubId = await createUserClub(req.user.id, name, stadium, city);
    delete clubNameCache[clubId];
    const club = await queryOne('SELECT * FROM clubs WHERE id=$1', [clubId]);
    res.json({club: {...club, id: club.id}});
  } catch(err) { res.status(400).json({error:err.message}); }
});

app.get('/api/club', auth, requireClub, async(req, res) => {
  try {
    const club = await queryOne('SELECT * FROM clubs WHERE id=$1', [req.user.clubId]);
    const squad = await queryAll('SELECT id FROM players WHERE club_id=$1', [req.user.clubId]);
    const totalWages = squad.length > 0 
      ? (await queryAll('SELECT salary FROM players WHERE club_id=$1', [req.user.clubId]))
        .reduce((s, p) => s + (p.salary || 0), 0)
      : 0;
    res.json({club: {...club, id: club.id}, squadSize: squad.length, totalWages});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, requireClub, async(req, res) => {
  try {
    const [club, season, standings] = await Promise.all([
      queryOne('SELECT * FROM clubs WHERE id=$1', [req.user.clubId]),
      getSeason(),
      getStandings(),
    ]);
    const standing = standings.find(s => s.clubId === req.user.clubId);

    // Next match
    const nextMatches = await queryAll(`
      SELECT * FROM matches WHERE matchday=$1 AND simulated=FALSE
    `, [season.currentMatchday]);
    let nextMatch = null;
    if(nextMatches.length > 0) {
      const enriched = await Promise.all(nextMatches.map(enrichMatch));
      nextMatch = enriched.find(m => m.homeTeamId === req.user.clubId || m.awayTeamId === req.user.clubId) || null;
    }

    // Last match
    const lastMatches = await queryAll(`
      SELECT * FROM matches WHERE simulated=TRUE AND (home_team_id=$1 OR away_team_id=$1)
      ORDER BY played_at DESC LIMIT 1
    `, [req.user.clubId]);
    let lastMatch = null;
    if(lastMatches.length > 0) {
      lastMatch = await enrichMatch(lastMatches[0]);
    }

    // Total wages
    const wageRows = await queryAll('SELECT salary FROM players WHERE club_id=$1', [req.user.clubId]);
    const totalWages = wageRows.reduce((s, p) => s + (p.salary || 0), 0);

    res.json({
      club: {...club, id: club.id},
      season,
      standing,
      nextMatch,
      lastMatch,
      totalWages
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Squad Routes ─────────────────────────────────────────────────────────────
app.get('/api/squad', auth, requireClub, async(req, res) => {
  try {
    let players = await queryAll('SELECT * FROM players WHERE club_id=$1', [req.user.clubId]);
    const { sort='ovr', order='desc', position } = req.query;
    if(position) players = players.filter(p => p.position === position);
    players.sort((a,b) => order==='asc' ? a[sort]-b[sort] : b[sort]-a[sort]);
    // Map DB column names to camelCase for frontend
    players = players.map(p => ({
      id: p.id, clubId: p.club_id, firstName: p.first_name, lastName: p.last_name,
      age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
      pace: p.pace, shooting: p.shooting, passing: p.passing,
      defending: p.defending, physical: p.physical, goalkeeping: p.goalkeeping,
      fitness: p.fitness, morale: p.morale, form: p.form,
      goals: p.goals, assists: p.assists, appearances: p.appearances,
      yellowCards: p.yellow_cards, redCards: p.red_cards,
      careerGoals: p.career_goals, careerAssists: p.career_assists,
      careerAppearances: p.career_appearances,
      value: p.value, salary: p.salary,
      injuryType: p.injury_type, injuryWeeks: p.injury_weeks, suspended: p.suspended,
      isListed: p.is_listed, askingPrice: p.asking_price,
      contractYears: p.contract_years,
    }));
    res.json({players});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get('/api/squad/:id', auth, requireClub, async(req, res) => {
  try {
    const p = await queryOne('SELECT * FROM players WHERE id=$1 AND club_id=$2', [req.params.id, req.user.clubId]);
    if(!p) return res.status(404).json({error:'Player not found'});
    res.json({player: {
      id: p.id, clubId: p.club_id, firstName: p.first_name, lastName: p.last_name,
      age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
      pace: p.pace, shooting: p.shooting, passing: p.passing,
      defending: p.defending, physical: p.physical, goalkeeping: p.goalkeeping,
      fitness: p.fitness, morale: p.morale, form: p.form,
      goals: p.goals, assists: p.assists, appearances: p.appearances,
      yellowCards: p.yellow_cards, redCards: p.red_cards,
      value: p.value, salary: p.salary,
      injuryType: p.injury_type, injuryWeeks: p.injury_weeks, suspended: p.suspended,
    }});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Transfer Market ──────────────────────────────────────────────────────────
app.get('/api/transfers/market', auth, requireClub, async(req, res) => {
  try {
    let players = await queryAll('SELECT * FROM players WHERE club_id IS NULL AND is_listed=TRUE');
    const { sort='ovr', order='desc', position, maxPrice } = req.query;
    if(position) players = players.filter(p => p.position === position);
    if(maxPrice) players = players.filter(p => p.asking_price <= parseInt(maxPrice));
    players.sort((a,b) => order==='asc' ? a[sort]-b[sort] : b[sort]-a[sort]);
    const club = await queryOne('SELECT transfer_budget FROM clubs WHERE id=$1', [req.user.clubId]);
    players = players.map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
      value: p.value, salary: p.salary, askingPrice: p.asking_price,
    }));
    res.json({players, budget: club.transfer_budget});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/transfers/buy/:playerId', auth, requireClub, async(req, res) => {
  try {
    const player = await queryOne('SELECT * FROM players WHERE id=$1', [req.params.playerId]);
    if(!player || player.club_id !== null || !player.is_listed) return res.status(404).json({error:'Player not available'});
    const club = await queryOne('SELECT * FROM clubs WHERE id=$1', [req.user.clubId]);
    if(club.transfer_budget < player.asking_price) return res.status(400).json({error:'Insufficient transfer budget'});
    const squadCount = await queryOne('SELECT COUNT(*) as cnt FROM players WHERE club_id=$1', [req.user.clubId]);
    if(squadCount.cnt >= 30) return res.status(400).json({error:'Squad is full (max 30)'});
    const season = await getSeason();
    
    await transaction(async (client) => {
      await client.query('UPDATE players SET club_id=$1, is_listed=FALSE, asking_price=0, contract_years=3 WHERE id=$2',
        [req.user.clubId, player.id]);
      await client.query('UPDATE clubs SET transfer_budget=transfer_budget-$1, balance=balance-$1 WHERE id=$2',
        [player.asking_price, req.user.clubId]);
      await client.query(`
        INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday)
        VALUES ($1, NULL, $2, $3, $4)
      `, [player.id, req.user.clubId, player.asking_price, season.currentMatchday]);
    });
    
    await createNotification(req.user.id, 'transfer_in', 'Player Signed',
      `${player.first_name} ${player.last_name} joined for ${formatMoney(player.asking_price)}`);
    res.json({message:`Signed ${player.first_name} ${player.last_name}`, player});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get('/api/transfers/listed', auth, requireClub, async(req, res) => {
  try {
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1 AND is_listed=TRUE', [req.user.clubId]);
    res.json({players: players.map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      age: p.age, position: p.position, ovr: p.ovr, askingPrice: p.asking_price,
    }))});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/transfers/sell/:playerId', auth, requireClub, async(req, res) => {
  try {
    const player = await queryOne('SELECT * FROM players WHERE id=$1 AND club_id=$2', [req.params.playerId, req.user.clubId]);
    if(!player) return res.status(404).json({error:'Player not in your squad'});
    const squadCount = await queryOne('SELECT COUNT(*) as cnt FROM players WHERE club_id=$1', [req.user.clubId]);
    if(squadCount.cnt <= 16) return res.status(400).json({error:'Cannot sell: minimum squad size is 16'});
    const season = await getSeason();
    const sellPrice = Math.round(player.value * 0.9);
    const listPrice = player.asking_price || Math.round(player.value * 1.1);
    
    await transaction(async (client) => {
      await client.query('UPDATE players SET club_id=NULL, is_listed=TRUE, asking_price=$1 WHERE id=$2',
        [listPrice, player.id]);
      await client.query('UPDATE clubs SET transfer_budget=transfer_budget+$1, balance=balance+$1 WHERE id=$2',
        [sellPrice, req.user.clubId]);
      await client.query(`
        INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday)
        VALUES ($1, $2, NULL, $3, $4)
      `, [player.id, req.user.clubId, sellPrice, season.currentMatchday]);
    });
    
    res.json({message:`${player.first_name} ${player.last_name} listed. Received ${formatMoney(sellPrice)}.`});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Training ─────────────────────────────────────────────────────────────────
app.get('/api/training', auth, requireClub, async(req, res) => {
  try {
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1 ORDER BY ovr DESC', [req.user.clubId]);
    res.json({players: players.map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
      fitness: p.fitness,
    }))});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/training/:playerId', auth, requireClub, async(req, res) => {
  try {
    const { focus } = req.body;
    const player = await queryOne('SELECT * FROM players WHERE id=$1 AND club_id=$2', [req.params.playerId, req.user.clubId]);
    if(!player) return res.status(404).json({error:'Player not found'});
    if(player.fitness < 30) return res.status(400).json({error:'Fitness too low'});
    const club = await queryOne('SELECT balance FROM clubs WHERE id=$1', [req.user.clubId]);
    if(club.balance < 10000) return res.status(400).json({error:'Insufficient funds'});
    
    const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
    const gap = player.potential - player.ovr;
    let improvement = gap > 0 ? Math.min(Math.ceil(Math.random()*2*ageFactor), Math.ceil(gap/5)) : Math.random() < 0.2 ? 1 : 0;
    
    const updates = {};
    const attrs = focus === 'general' ? ['pace','shooting','passing','defending','physical'] : [focus];
    for(const attr of attrs) {
      if(attr === 'general') continue;
      const gain = attr === focus ? improvement : (improvement > 0 && Math.random() < 0.3 ? 1 : 0);
      if(gain > 0 && player[attr] < 99) updates[attr] = Math.min(99, player[attr] + gain);
    }
    
    const updated = {...player, ...updates};
    const newOvr = calculateOVR(player.position, updated);
    const fitDrop = Math.floor(Math.random() * 8) + 5;
    
    const setClauses = Object.entries(updates).map(([k,v], i) => `${k}=$${i+1}`).join(', ');
    const params = [...Object.values(updates), newOvr, Math.max(40, player.fitness - fitDrop), player.id];
    const idx = Object.keys(updates).length + 1;
    
    await query(`UPDATE players SET ${setClauses}, ovr=$${idx}, fitness=$${idx+1} WHERE id=$${idx+2}`, params);
    
    await query('UPDATE clubs SET balance=balance-10000 WHERE id=$1', [req.user.clubId]);
    
    const fresh = await queryOne('SELECT * FROM players WHERE id=$1', [player.id]);
    res.json({
      message:`Training complete for ${player.first_name} ${player.last_name}`,
      player: fresh,
      improvements: updates
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/training/batch', auth, requireClub, async(req, res) => {
  try {
    const { focus } = req.body;
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1 AND fitness >= 30', [req.user.clubId]);
    const club = await queryOne('SELECT balance FROM clubs WHERE id=$1', [req.user.clubId]);
    const cost = players.length * 10000;
    if(club.balance < cost) return res.status(400).json({error:'Insufficient funds for batch training'});
    
    let trained = 0;
    for(const player of players) {
      const ageFactor = player.age < 23 ? 1.5 : player.age < 28 ? 1.0 : player.age < 32 ? 0.6 : 0.3;
      const gap = player.potential - player.ovr;
      let improvement = gap > 0 ? Math.min(Math.ceil(Math.random()*2*ageFactor), Math.ceil(gap/5)) : Math.random() < 0.2 ? 1 : 0;
      
      const updates = {};
      const attrs = focus === 'general' ? ['pace','shooting','passing','defending','physical'] : [focus];
      for(const attr of attrs) {
        if(attr === 'general') continue;
        const gain = attr === focus ? improvement : (improvement > 0 && Math.random() < 0.3 ? 1 : 0);
        if(gain > 0 && player[attr] < 99) updates[attr] = Math.min(99, player[attr] + gain);
      }
      
      const updated = {...player, ...updates};
      const newOvr = calculateOVR(player.position, updated);
      const fitDrop = Math.floor(Math.random() * 8) + 5;
      
      const setClauses = Object.entries(updates).map(([k,v], i) => `${k}=$${i+1}`).join(', ');
      const params = [...Object.values(updates), newOvr, Math.max(40, player.fitness - fitDrop), player.id];
      const idx = Object.keys(updates).length + 1;
      
      if(setClauses) {
        await query(`UPDATE players SET ${setClauses}, ovr=$${idx}, fitness=$${idx+1} WHERE id=$${idx+2}`, params);
      }
      trained++;
    }
    
    await query('UPDATE clubs SET balance=balance-$1 WHERE id=$1', [cost]);
    res.json({message:`Trained ${trained} players with focus: ${focus}`});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Player Profile ──────────────────────────────────────────────────────────
app.get('/api/players/:id', auth, async(req, res) => {
  try {
    const p = await queryOne('SELECT * FROM players WHERE id=$1', [req.params.id]);
    if(!p) return res.status(404).json({error:'Player not found'});
    let clubName = 'Free Agent';
    if(p.club_id) {
      const club = await queryOne('SELECT name FROM clubs WHERE id=$1', [p.club_id]);
      clubName = club?.name || 'Unknown';
    }
    res.json({
      player: {
        id: p.id, clubId: p.club_id, firstName: p.first_name, lastName: p.last_name,
        age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
        pace: p.pace, shooting: p.shooting, passing: p.passing,
        defending: p.defending, physical: p.physical, goalkeeping: p.goalkeeping,
        fitness: p.fitness, morale: p.morale, form: p.form,
        goals: p.goals, assists: p.assists, appearances: p.appearances,
        yellowCards: p.yellow_cards, redCards: p.red_cards,
        careerGoals: p.career_goals, careerAssists: p.career_assists,
        careerAppearances: p.career_appearances,
        value: p.value, salary: p.salary,
        injuryType: p.injury_type, injuryWeeks: p.injury_weeks, suspended: p.suspended,
        seasonHistory: p.season_history || [],
      },
      clubName
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get('/api/players/:id/career', auth, async(req, res) => {
  try {
    const p = await queryOne('SELECT * FROM players WHERE id=$1', [req.params.id]);
    if(!p) return res.status(404).json({error:'Player not found'});
    
    let clubName = 'Free Agent';
    if(p.club_id) {
      const club = await queryOne('SELECT name FROM clubs WHERE id=$1', [p.club_id]);
      clubName = club?.name || 'Unknown';
    }
    
    // Get recent matches for this player
    const matches = await queryAll(`
      SELECT * FROM matches WHERE simulated=TRUE 
      AND (home_team_id=$1 OR away_team_id=$1)
      ORDER BY played_at DESC LIMIT 10
    `, [p.club_id]);
    
    const recentMatches = [];
    for(const m of matches) {
      const events = (m.events || []).filter(e => e.playerId == p.id);
      const [home, away] = await Promise.all([resolveClubName(m.home_team_id), resolveClubName(m.away_team_id)]);
      recentMatches.push({
        matchId: m.id, matchday: m.matchday,
        homeName: home.name, awayName: away.name,
        homeGoals: m.home_goals, awayGoals: m.away_goals,
        goals: events.filter(e => e.type === 'goal').length,
        assists: events.filter(e => e.assistId == p.id).length,
        playedAt: m.played_at,
      });
    }
    
    res.json({
      player: {
        id: p.id, clubId: p.club_id, firstName: p.first_name, lastName: p.last_name,
        age: p.age, position: p.position, ovr: p.ovr, potential: p.potential,
        pace: p.pace, shooting: p.shooting, passing: p.passing,
        defending: p.defending, physical: p.physical, goalkeeping: p.goalkeeping,
        fitness: p.fitness, morale: p.morale, form: p.form,
        value: p.value, salary: p.salary,
        injuryType: p.injury_type, injuryWeeks: p.injury_weeks, suspended: p.suspended,
      },
      clubName,
      careerStats: {
        goals: p.career_goals || p.goals || 0,
        assists: p.career_assists || p.assists || 0,
        appearances: p.career_appearances || p.appearances || 0,
        yellowCards: p.career_yellow_cards || p.yellow_cards || 0,
        redCards: p.career_red_cards || p.red_cards || 0,
        cleanSheets: p.career_clean_sheets || 0,
        motm: p.career_motm || 0,
      },
      seasonHistory: p.season_history || [],
      recentMatches,
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Tactics ─────────────────────────────────────────────────────────────────
app.get('/api/tactics', auth, requireClub, async(req, res) => {
  try {
    const club = await queryOne('SELECT tactics FROM clubs WHERE id=$1', [req.user.clubId]);
    const tactics = club.tactics || {formation:'4-4-2',mentality:'balanced',pressing:'normal',tempo:'normal',passingStyle:'mixed',captainId:null,lineup:{}};
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1', [req.user.clubId]);
    res.json({tactics, players: players.map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      position: p.position, ovr: p.ovr,
    }))});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/tactics', auth, requireClub, async(req, res) => {
  try {
    const { formation, mentality, pressing, tempo, passingStyle, captainId, lineup } = req.body;
    await query('UPDATE clubs SET tactics=$1 WHERE id=$2', [
      JSON.stringify({formation:formation||'4-4-2',mentality:mentality||'balanced',pressing:pressing||'normal',tempo:tempo||'normal',passingStyle:passingStyle||'mixed',captainId:captainId||null,lineup:lineup||{}}),
      req.user.clubId
    ]);
    res.json({success:true,message:'Tactics saved'});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get('/api/clubs/:id/tactics', auth, async(req, res) => {
  try {
    const club = await queryOne('SELECT tactics FROM clubs WHERE id=$1', [req.params.id]);
    if(!club) return res.status(404).json({error:'Club not found'});
    const tactics = club.tactics || {formation:'4-4-2'};
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1 ORDER BY ovr DESC', [req.params.id]);
    res.json({tactics, players: players.map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      position: p.position, ovr: p.ovr,
    }))});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Match Routes ─────────────────────────────────────────────────────────────
app.get('/api/matches/current', auth, requireClub, async(req, res) => {
  try {
    const season = await getSeason();
    if(!season) return res.status(500).json({error:'Season not initialized'});
    const matches = await queryAll('SELECT * FROM matches WHERE matchday=$1', [season.currentMatchday]);
    const enriched = await Promise.all(matches.map(enrichMatch));
    const userMatch = enriched.find(m => m.homeTeamId === req.user.clubId || m.awayTeamId === req.user.clubId) || null;
    const allSimulated = enriched.length > 0 && enriched.every(m => m.simulated);
    res.json({matchday:season.currentMatchday, matches:enriched, userMatch, status:season.status, allSimulated, totalMatchdays:season.totalMatchdays});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/matches/simulate', auth, requireClub, async(req, res) => {
  try {
    const season = await getSeason();
    if(season.status === 'finished') return res.status(400).json({error:'Season is finished'});
    const unsim = await queryAll('SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE', [season.currentMatchday]);
    if(unsim.length === 0) return res.status(400).json({error:'Already simulated. Advance matchday.'});
    
    const results = await simulateMatchday(season.currentMatchday);
    await aiTransferActions();
    const standings = await getStandings();
    const userResult = results.find(r => r.homeTeamId === req.user.clubId || r.awayTeamId === req.user.clubId);
    
    if(userResult) {
      const isHome = userResult.homeTeamId === req.user.clubId;
      const ug = isHome ? userResult.homeGoals : userResult.awayGoals;
      const og = isHome ? userResult.awayGoals : userResult.homeGoals;
      const oppId = isHome ? userResult.awayTeamId : userResult.homeTeamId;
      const opp = await queryOne('SELECT name FROM clubs WHERE id=$1', [oppId]);
      if(ug > og) await createNotification(req.user.id, 'match_win', 'Victory!', `You defeated ${opp?.name} ${ug}-${og}`);
      else if(ug < og) await createNotification(req.user.id, 'match_loss', 'Defeat', `You lost to ${opp?.name} ${ug}-${og}`);
      else await createNotification(req.user.id, 'match_draw', 'Draw', `You drew with ${opp?.name} ${ug}-${og}`);
    }
    
    const enriched = await Promise.all(results.map(async r => {
      const [home, away] = await Promise.all([resolveClubName(r.homeTeamId), resolveClubName(r.awayTeamId)]);
      return {...r, homeName:home.name, awayName:away.name};
    }));
    res.json({matchday:season.currentMatchday, results:enriched, userResult, standings, canAdvance:true});
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/matches/advance', auth, requireClub, async(req, res) => {
  try {
    const success = await advanceMatchday();
    if(!success) return res.json({message:'Season finished!', finished:true, standings:await getStandings()});
    const season = await getSeason();
    res.json({message:`Advanced to matchday ${season.currentMatchday}`, matchday:season.currentMatchday, season});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Match Status (polling) ──────────────────────────────────────────────────
app.get('/api/matches/status', auth, requireClub, async(req, res) => {
  try {
    await ensureSimulated();
    const season = await getSeason();
    if(!season) return res.json({status:'initializing'});
    const unsim = await queryAll('SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE', [season.currentMatchday]);
    const allSimulated = unsim.length === 0;
    const allMatches = await queryAll('SELECT * FROM matches WHERE matchday=$1', [season.currentMatchday]);
    const userMatchRow = allMatches.find(m => m.home_team_id === req.user.clubId || m.away_team_id === req.user.clubId);
    let userMatch = null;
    if(userMatchRow) userMatch = await enrichMatch(userMatchRow);
    res.json({
      seasonNumber: season.seasonNumber,
      currentMatchday: season.currentMatchday,
      totalMatchdays: season.totalMatchdays,
      status: season.status,
      allSimulated,
      userMatch,
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Admin Simulate (for serverless/cron) ────────────────────────────────────
app.post('/api/admin/simulate', async(req, res) => {
  try {
    await bootstrap();
    const season = await getSeason();
    if(!season || season.status === 'finished') return res.json({message:'Season finished or not initialized', status:season?.status});
    const unsim = await queryAll('SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE', [season.currentMatchday]);
    if(unsim.length === 0) {
      await advanceMatchday();
      const newSeason = await getSeason();
      return res.json({message:`Advanced to matchday ${newSeason.currentMatchday}`, matchday:newSeason.currentMatchday});
    }
    const results = await simulateMatchday(season.currentMatchday);
    await aiTransferActions();
    res.json({message:`Simulated matchday ${season.currentMatchday}`, results:results.length});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Match History ────────────────────────────────────────────────────────────
app.get('/api/matches/history', auth, requireClub, async(req, res) => {
  try {
    const matches = await queryAll(`
      SELECT * FROM matches WHERE simulated=TRUE AND (home_team_id=$1 OR away_team_id=$1)
      ORDER BY played_at DESC
    `, [req.user.clubId]);
    const enriched = await Promise.all(matches.map(enrichMatch));
    res.json({matches: enriched});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Match Report ─────────────────────────────────────────────────────────────
app.get('/api/matches/report/:id', auth, async(req, res) => {
  try {
    const m = await queryOne('SELECT * FROM matches WHERE id=$1', [req.params.id]);
    if(!m) return res.status(404).json({error:'Match not found'});
    const [home, away] = await Promise.all([resolveClubName(m.home_team_id), resolveClubName(m.away_team_id)]);
    const match = {
      id: m.id, matchday: m.matchday,
      homeTeamId: m.home_team_id, awayTeamId: m.away_team_id,
      homeName: home.name, homeShort: home.shortName,
      awayName: away.name, awayShort: away.shortName,
      homeGoals: m.home_goals, awayGoals: m.away_goals,
    };
    const events = m.events || [];
    const stats = {
      home: {
        possession: m.home_possession || 50, shots: m.home_shots || 0,
        shotsOnTarget: m.home_shots_on_target || 0, corners: m.home_corners || 0, fouls: m.home_fouls || 0,
      },
      away: {
        possession: m.away_possession || 50, shots: m.away_shots || 0,
        shotsOnTarget: m.away_shots_on_target || 0, corners: m.away_corners || 0, fouls: m.away_fouls || 0,
      },
    };
    
    const [hPlayers, aPlayers] = await Promise.all([
      queryAll('SELECT * FROM players WHERE club_id=$1', [m.home_team_id]),
      queryAll('SELECT * FROM players WHERE club_id=$1', [m.away_team_id]),
    ]);
    
    const goalScores = {}, assistCounts = {}, yellowCards = {}, redCards = {};
    for(const e of events) {
      if(e.playerId) {
        if(e.type === 'goal') goalScores[e.playerId] = (goalScores[e.playerId] || 0) + 1;
        if(e.assistId) assistCounts[e.assistId] = (assistCounts[e.assistId] || 0) + 1;
        if(e.type === 'yellow') yellowCards[e.playerId] = (yellowCards[e.playerId] || 0) + 1;
        if(e.type === 'red') redCards[e.playerId] = (redCards[e.playerId] || 0) + 1;
      }
    }
    
    const allPlayers = [
      ...hPlayers.map(p => ({...p, team:'home'})),
      ...aPlayers.map(p => ({...p, team:'away'}))
    ];
    
    const playerRatings = allPlayers.map(p => {
      const goals = goalScores[p.id] || 0;
      const assists = assistCounts[p.id] || 0;
      const yellows = yellowCards[p.id] || 0;
      const reds = redCards[p.id] || 0;
      let rating = 6.5 + goals*0.8 + assists*0.4 - yellows*0.3 - reds*1.5 + (p.ovr-65)*0.02 + Math.random()*0.6-0.3;
      rating = Math.max(4.0, Math.min(10.0, Math.round(rating*10)/10));
      return {name:`${p.first_name} ${p.last_name}`, team:p.team, goals, assists, rating};
    });
    playerRatings.sort((a,b) => b.rating - a.rating);
    
    res.json({match, events, stats, playerRatings});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── League ───────────────────────────────────────────────────────────────────
app.get('/api/league', auth, async(req, res) => {
  try {
    const [standings, season] = await Promise.all([getStandings(), getSeason()]);
    res.json({standings, season});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Finances ─────────────────────────────────────────────────────────────────
app.get('/api/finances', auth, requireClub, async(req, res) => {
  try {
    const [club, players, transfers] = await Promise.all([
      queryOne('SELECT balance, transfer_budget, wage_budget FROM clubs WHERE id=$1', [req.user.clubId]),
      queryAll('SELECT * FROM players WHERE club_id=$1', [req.user.clubId]),
      queryAll(`
        SELECT t.*, p.first_name, p.last_name FROM transfers t
        JOIN players p ON t.player_id = p.id
        WHERE t.from_club_id=$1 OR t.to_club_id=$1
        ORDER BY t.created_at DESC LIMIT 20
      `, [req.user.clubId]),
    ]);
    const totalWages = players.reduce((s,p) => s + (p.salary || 0), 0);
    const totalValue = players.reduce((s,p) => s + (p.value || 0), 0);
    res.json({
      club:{balance:club.balance, transferBudget:club.transfer_budget, wageBudget:club.wage_budget},
      totalWages, totalValue, players,
      recentTransfers: transfers.map(t => ({
        id: t.id, playerId: t.player_id, fromClubId: t.from_club_id, toClubId: t.to_club_id,
        fee: t.fee, matchday: t.matchday,
        firstName: t.first_name, lastName: t.last_name,
      })),
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Leaderboards ─────────────────────────────────────────────────────────────
app.get('/api/leaderboards', auth, async(req, res) => {
  try {
    const allPlayers = await queryAll(`
      SELECT p.*, c.name as club_name FROM players p
      LEFT JOIN clubs c ON p.club_id = c.id
      WHERE p.club_id IS NOT NULL
    `);
    const withClub = allPlayers.map(p => ({...p, clubName: p.club_name || 'Unknown'}));
    res.json({
      topScorers: [...withClub].filter(p => p.goals > 0).sort((a,b) => b.goals - a.goals).slice(0,20),
      topAssists: [...withClub].filter(p => p.assists > 0).sort((a,b) => b.assists - a.assists).slice(0,20),
      highestOvr: [...withClub].sort((a,b) => b.ovr - a.ovr).slice(0,20),
      mostValuable: [...withClub].sort((a,b) => b.value - a.value).slice(0,20),
      topCareerScorers: [...withClub].filter(p => p.career_goals > 0).sort((a,b) => b.career_goals - a.career_goals).slice(0,20),
      mostAppearances: [...withClub].filter(p => p.career_appearances > 0).sort((a,b) => b.career_appearances - a.career_appearances).slice(0,20),
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Club Profile ─────────────────────────────────────────────────────────────
app.get('/api/clubs/:id', auth, async(req, res) => {
  try {
    const club = await queryOne('SELECT * FROM clubs WHERE id=$1', [req.params.id]);
    if(!club) return res.status(404).json({error:'Club not found'});
    const squad = await queryAll('SELECT * FROM players WHERE club_id=$1 ORDER BY ovr DESC', [req.params.id]);
    const standings = await getStandings();
    const standing = standings.find(s => s.clubId === parseInt(req.params.id));
    const recentMatches = await queryAll(`
      SELECT * FROM matches WHERE simulated=TRUE AND (home_team_id=$1 OR away_team_id=$1)
      ORDER BY played_at DESC LIMIT 5
    `, [req.params.id]);
    const enrichedMatches = await Promise.all(recentMatches.map(enrichMatch));
    
    const avgOvr = squad.length > 0 ? Math.round(squad.reduce((s,p) => s + p.ovr, 0) / squad.length) : 0;
    const totalValue = squad.reduce((s,p) => s + (p.value || 0), 0);
    const avgAge = squad.length > 0 ? Math.round(squad.reduce((s,p) => s + p.age, 0) / squad.length * 10) / 10 : 0;
    const injuredCount = squad.filter(p => p.injury_type).length;
    
    const formGuide = enrichedMatches.map(m => {
      const isHome = m.homeTeamId === parseInt(req.params.id);
      const userGoals = isHome ? m.homeGoals : m.awayGoals;
      const oppGoals = isHome ? m.awayGoals : m.homeGoals;
      return userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';
    });
    
    res.json({
      club: {...club, id: club.id},
      squad: squad.map(p => ({
        id: p.id, firstName: p.first_name, lastName: p.last_name,
        age: p.age, position: p.position, ovr: p.ovr,
        injuryType: p.injury_type,
      })),
      standing,
      recentMatches: enrichedMatches,
      stats: {avgOvr, totalValue, avgAge, squadSize: squad.length, injuredCount},
      formGuide,
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Awards ───────────────────────────────────────────────────────────────────
app.get('/api/awards', auth, async(req, res) => {
  try {
    const season = await getSeason();
    const currentSeasonNum = season ? season.seasonNumber : 1;
    const awards = await queryAll('SELECT * FROM awards ORDER BY season_number DESC');
    res.json({
      awards: awards.map(a => ({
        seasonNumber: a.season_number,
        champion: a.champion,
        topScorer: a.top_scorer,
        topAssister: a.top_assister,
        bestYoung: a.best_young,
        relegated: a.relegated,
        promoted: a.promoted,
      })),
      currentSeason: currentSeasonNum,
      standings: await getStandings(),
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Injuries ─────────────────────────────────────────────────────────────────
app.get('/api/injuries', auth, requireClub, async(req, res) => {
  try {
    const players = await queryAll('SELECT * FROM players WHERE club_id=$1', [req.user.clubId]);
    const injured = players.filter(p => p.injury_type && p.injury_weeks > 0).map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      position: p.position, ovr: p.ovr,
      injuryType: p.injury_type, injuryWeeks: p.injury_weeks,
    }));
    const suspended = players.filter(p => p.suspended).map(p => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name,
      position: p.position, ovr: p.ovr,
    }));
    res.json({injured, suspended});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, async(req, res) => {
  try {
    const notifications = await queryAll(`
      SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50
    `, [req.user.id]);
    res.json({
      notifications: notifications.map(n => ({
        id: n.id, type: n.type, title: n.title, message: n.message, read: n.read,
      })),
      unreadCount: notifications.filter(n => !n.read).length
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.post('/api/notifications/read-all', auth, async(req, res) => {
  try {
    await query('UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE', [req.user.id]);
    res.json({success:true});
  } catch(err) { res.status(500).json({error:err.message}); }
});

async function createNotification(userId, type, title, message) {
  await query('INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
    [userId, type, title, message]);
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', async(req, res) => {
  const dbOk = await healthCheck();
  res.json({status: dbOk ? 'ok' : 'error', database: dbOk ? 'connected' : 'disconnected'});
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
let initialized = false;
let autoSimStarted = false;

async function bootstrap() {
  if(!initialized) {
    try {
      await ensureSchema();
      await initializeGame();
      initialized = true;
      if(process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
        startAutoSimulation();
        autoSimStarted = true;
      }
    } catch(err) { console.error('Init error:', err.message); }
  }
}

async function ensureSimulated() {
  if(autoSimStarted) return;
  if(process.env.VERCEL || process.env.NODE_ENV === 'production') {
    try {
      const season = await getSeason();
      if(!season || season.status === 'finished') return;
      const unsim = await queryAll('SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE', [season.currentMatchday]);
      if(unsim.length > 0) {
        console.log(`[Serverless] Simulating matchday ${season.currentMatchday}`);
        await simulateMatchday(season.currentMatchday);
        await aiTransferActions();
      }
    } catch(err) { console.error('[Serverless] Sim error:', err.message); }
  }
}

if(process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  bootstrap().then(() => app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`)));
}

module.exports = async(req, res) => { await bootstrap(); await ensureSimulated(); app(req, res); };
