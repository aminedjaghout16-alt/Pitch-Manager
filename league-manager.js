const { query, queryOne, queryAll, transaction } = require('./db');
const { generateSquad, insertPlayer, generateTransferMarket, calculateValue, calculateSalary } = require('./player-generator');
const { simulateMatchday } = require('./match-simulator');

const CLUB_DATA = [
  {name:'Greenfield United',shortName:'GRN',stadium:'Greenfield Arena',city:'Greenfield',strength:0.9},
  {name:'Royal Sporting',shortName:'ROY',stadium:'Royal Park',city:'Kingsbury',strength:0.85},
  {name:'Northbridge FC',shortName:'NBR',stadium:'Northbridge Stadium',city:'Northbridge',strength:0.8},
  {name:'Westwood City',shortName:'WST',stadium:'Westwood Ground',city:'Westwood',strength:0.75},
  {name:'Eastham Rovers',shortName:'EAH',stadium:'Eastham Park',city:'Eastham',strength:0.7},
  {name:'Southgate Athletic',shortName:'SGA',stadium:'Southgate Stadium',city:'Southgate',strength:0.65},
  {name:'Ironville Town',shortName:'IRN',stadium:'Iron Works',city:'Ironville',strength:0.6},
  {name:'Lakeside FC',shortName:'LAK',stadium:'Lakeview Arena',city:'Lakeside',strength:0.55},
  {name:'Stormborough FC',shortName:'STM',stadium:'Storm Park',city:'Stormborough',strength:0.5},
  {name:'Fairview United',shortName:'FRV',stadium:'Fairview Ground',city:'Fairview',strength:0.5},
  {name:'Crestwood FC',shortName:'CRS',stadium:'Crestwood Stadium',city:'Crestwood',strength:0.45},
  {name:'Ashford Wanderers',shortName:'ASH',stadium:'Ashford Lane',city:'Ashford',strength:0.45},
  {name:'Brighton Athletic',shortName:'BRI',stadium:'Brighton Park',city:'Brighton',strength:0.4},
  {name:'Dunmore FC',shortName:'DUN',stadium:'Dunmore Arena',city:'Dunmore',strength:0.4},
  {name:'Elkstone Rovers',shortName:'ELK',stadium:'Elkstone Ground',city:'Elkstone',strength:0.35},
  {name:'Foxwood City',shortName:'FOX',stadium:'Foxwood Stadium',city:'Foxwood',strength:0.35},
  {name:'Hartley United',shortName:'HRT',stadium:'Hartley Park',city:'Hartley',strength:0.3},
  {name:'Kingsway FC',shortName:'KNG',stadium:'Kingsway Arena',city:'Kingsway',strength:0.3},
  {name:'Millfield Town',shortName:'MIL',stadium:'Millfield Ground',city:'Millfield',strength:0.25},
  {name:'Oakdale FC',shortName:'OAK',stadium:'Oakdale Stadium',city:'Oakdale',strength:0.25},
];

// ─── Fixture Generation ─────────────────────────────────────────────────────

function generateFixtures(teamIds) {
  const n = teamIds.length, fixtures = [], teams = [...teamIds], half = Math.floor(n/2);
  for(let r=0; r<n-1; r++){
    const md = r+1;
    for(let i=0; i<half; i++){
      const h = teams[i], a = teams[n-1-i];
      if(h===a) continue;
      fixtures.push(r%2===0 ? {matchday:md, homeTeamId:h, awayTeamId:a} : {matchday:md, homeTeamId:a, awayTeamId:h});
    }
    teams.splice(1, 0, teams.pop());
  }
  const off = n-1;
  const firstLeg = [...fixtures];
  for(const f of firstLeg){
    if(f.homeTeamId===f.awayTeamId) continue;
    fixtures.push({matchday:f.matchday+off, homeTeamId:f.awayTeamId, awayTeamId:f.homeTeamId});
  }
  return fixtures.filter(f => f.homeTeamId && f.awayTeamId && f.homeTeamId !== f.awayTeamId);
}

// ─── Standings ──────────────────────────────────────────────────────────────

async function getStandings() {
  const [clubs, matches] = await Promise.all([
    queryAll('SELECT id, name, short_name FROM clubs'),
    queryAll('SELECT * FROM matches WHERE simulated=TRUE')
  ]);

  const standings = {};
  for(const c of clubs) {
    standings[c.id] = {
      clubId: c.id, name: c.name, shortName: c.short_name,
      played:0, won:0, drawn:0, lost:0,
      goalsFor:0, goalsAgainst:0, goalDifference:0, points:0
    };
  }

  for(const m of matches) {
    const h = standings[m.home_team_id], a = standings[m.away_team_id];
    if(!h || !a) continue;
    h.played++; a.played++;
    h.goalsFor += m.home_goals; h.goalsAgainst += m.away_goals;
    a.goalsFor += m.away_goals; a.goalsAgainst += m.home_goals;
    if(m.home_goals > m.away_goals) { h.won++; h.points += 3; a.lost++; }
    else if(m.home_goals < m.away_goals) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }

  const table = Object.values(standings);
  table.forEach(r => r.goalDifference = r.goalsFor - r.goalsAgainst);
  table.sort((a,b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor);
  table.forEach((r,i) => r.position = i+1);
  return table;
}

// ─── Season Management ──────────────────────────────────────────────────────

async function getSeason() {
  const row = await queryOne("SELECT data FROM meta WHERE key='season'");
  return row ? row.data : null;
}

async function advanceMatchday() {
  const season = await getSeason();
  
  if(season.currentMatchday >= season.totalMatchdays){
    await endOfSeason();
    await query("UPDATE meta SET data=jsonb_set(data, '{status}', '\"finished\"'), updated_at=NOW() WHERE key='season'");
    return false;
  }
  
  await query(`
    UPDATE meta SET 
      data=jsonb_set(data, '{currentMatchday}', to_jsonb((data->>'currentMatchday')::int + 1)),
      updated_at=NOW()
    WHERE key='season'
  `);
  
  await weeklyUpdates();
  return true;
}

// ─── Weekly Updates ─────────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

async function weeklyUpdates() {
  const players = await queryAll('SELECT id, fitness, morale, form, injury_type, injury_weeks, suspended FROM players');
  
  for(const p of players) {
    const updates = [];
    const params = [];
    let paramIdx = 1;
    
    if(p.injury_weeks > 0) {
      const newWeeks = p.injury_weeks - 1;
      updates.push(`injury_weeks=${paramIdx++}`); params.push(newWeeks);
      if(newWeeks <= 0) {
        updates.push(`injury_type=${paramIdx++}`); params.push(null);
        updates.push(`injury_weeks=${paramIdx++}`); params.push(0);
      }
    }
    
    if(p.suspended) {
      updates.push(`suspended=${paramIdx++}`); params.push(false);
    }
    
    if(!p.injury_type) {
      const newFit = Math.min(100, (p.fitness || 80) + rand(5, 15));
      updates.push(`fitness=${paramIdx++}`); params.push(newFit);
    }
    
    const currentForm = p.form || 70;
    const newForm = clamp(currentForm + rand(-5, 5), 30, 100);
    updates.push(`form=${paramIdx++}`); params.push(newForm);
    
    const newMorale = clamp((p.morale || 70) + rand(-3, 3), 20, 100);
    updates.push(`morale=${paramIdx++}`); params.push(newMorale);
    
    if(updates.length > 0) {
      params.push(p.id);
      await query(`UPDATE players SET ${updates.join(', ')} WHERE id=$${paramIdx}`, params);
    }
  }
}

// ─── End of Season ──────────────────────────────────────────────────────────

async function endOfSeason() {
  const season = await getSeason();
  const standings = await getStandings();
  const awards = await calculateSeasonAwards(standings, season.seasonNumber);
  
  const players = await queryAll('SELECT * FROM players');
  const clubs = await queryAll('SELECT id, name FROM clubs');
  const clubNames = {};
  clubs.forEach(c => { clubNames[c.id] = c.name; });
  
  for(const p of players) {
    const updates = { age: p.age + 1 };
    
    // Archive season history
    const history = p.season_history || [];
    history.push({
      season: season.seasonNumber,
      clubId: p.club_id,
      clubName: clubNames[p.club_id] || 'Unknown',
      goals: p.goals || 0,
      assists: p.assists || 0,
      appearances: p.appearances || 0,
      yellowCards: p.yellow_cards || 0,
      redCards: p.red_cards || 0,
    });
    updates.season_history = JSON.stringify(history);
    
    // Young players grow
    if(p.age < 24 && p.ovr < p.potential) {
      const growth = rand(1, 3);
      const newOvr = Math.min(p.potential, p.ovr + growth);
      if(newOvr !== p.ovr) {
        updates.ovr = newOvr;
        const attrs = ['pace','shooting','passing','defending','physical','goalkeeping'];
        for(const attr of attrs) {
          if(p[attr] < 99) updates[attr] = Math.min(99, p[attr] + rand(0, 2));
        }
        updates.value = calculateValue(newOvr, updates.age, p.position);
        updates.salary = calculateSalary(newOvr, updates.age);
      }
    }
    
    // Older players decline
    if(p.age >= 30) {
      const decline = p.age >= 33 ? rand(1, 3) : rand(0, 2);
      if(decline > 0 && p.ovr > 50) {
        updates.ovr = Math.max(50, p.ovr - decline);
        if(p.pace > 50) updates.pace = Math.max(50, p.pace - rand(1, 3));
        if(p.physical > 50) updates.physical = Math.max(50, p.physical - rand(0, 2));
        updates.value = calculateValue(updates.ovr, updates.age, p.position);
        updates.salary = calculateSalary(updates.ovr, updates.age);
      }
    }
    
    // Contract
    if(p.contract_years !== undefined && p.contract_years !== null) {
      updates.contract_years = p.contract_years - 1;
      if(updates.contract_years <= 0) {
        updates.club_id = null;
        updates.is_listed = true;
        updates.asking_price = 0;
      }
    }
    
    // Reset season stats
    updates.goals = 0;
    updates.assists = 0;
    updates.appearances = 0;
    updates.yellow_cards = 0;
    updates.red_cards = 0;
    
    // Build update query
    const setClauses = [];
    const params = [];
    let idx = 1;
    for(const [key, val] of Object.entries(updates)) {
      setClauses.push(`${key}=$${idx++}`);
      params.push(val);
    }
    params.push(p.id);
    
    if(setClauses.length > 0) {
      await query(`UPDATE players SET ${setClauses.join(', ')} WHERE id=$${idx}`, params);
    }
  }
  
  // Store awards
  await query(`
    INSERT INTO awards (season_number, champion, top_scorer, top_assister, best_young, relegated, promoted)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (season_number) DO UPDATE SET
      champion=$2, top_scorer=$3, top_assister=$4, best_young=$5, relegated=$6, promoted=$7
  `, [
    season.seasonNumber,
    JSON.stringify(awards.champion),
    JSON.stringify(awards.topScorer),
    JSON.stringify(awards.topAssister),
    JSON.stringify(awards.bestYoung),
    JSON.stringify(awards.relegated),
    JSON.stringify(awards.promoted)
  ]);
  
  await startNewSeason();
  return awards;
}

// ─── Season Awards ──────────────────────────────────────────────────────────

async function calculateSeasonAwards(standings, seasonNumber) {
  const allPlayers = await queryAll(`
    SELECT * FROM players WHERE club_id IS NOT NULL
  `);
  
  const topScorer = [...allPlayers].sort((a,b) => (b.goals||0) - (a.goals||0))[0];
  const topAssister = [...allPlayers].sort((a,b) => (b.assists||0) - (a.assists||0))[0];
  const champion = standings[0];
  
  const youngPlayers = allPlayers.filter(p => p.age < 23 && (p.goals||0) + (p.assists||0) > 0);
  const bestYoung = youngPlayers.sort((a,b) => b.ovr - a.ovr)[0];
  
  return {
    champion: champion ? { clubId: champion.clubId, name: champion.name, points: champion.points } : null,
    topScorer: topScorer ? {
      playerId: topScorer.id,
      name: `${topScorer.first_name} ${topScorer.last_name}`,
      clubId: topScorer.club_id,
      goals: topScorer.goals || 0,
      position: topScorer.position
    } : null,
    topAssister: topAssister ? {
      playerId: topAssister.id,
      name: `${topAssister.first_name} ${topAssister.last_name}`,
      clubId: topAssister.club_id,
      assists: topAssister.assists || 0,
      position: topAssister.position
    } : null,
    bestYoung: bestYoung ? {
      playerId: bestYoung.id,
      name: `${bestYoung.first_name} ${bestYoung.last_name}`,
      clubId: bestYoung.club_id,
      ovr: bestYoung.ovr,
      age: bestYoung.age
    } : null,
    relegated: standings.slice(-3).map(s => ({ clubId: s.clubId, name: s.name, position: s.position })),
    promoted: []
  };
}

// ─── Start New Season ───────────────────────────────────────────────────────

async function startNewSeason() {
  const season = await getSeason();
  const clubs = await queryAll('SELECT id FROM clubs');
  const clubIds = clubs.map(c => c.id);
  
  const fixtures = generateFixtures(clubIds);
  
  // Delete old matches
  await query('DELETE FROM matches');
  
  // Create new matches in batches
  for(let i = 0; i < fixtures.length; i += 100) {
    const batch = fixtures.slice(i, i + 100);
    const values = [];
    const params = [];
    let idx = 1;
    
    for(const f of batch) {
      values.push(`($${idx++}, $${idx++}, $${idx++})`);
      params.push(f.matchday, f.homeTeamId, f.awayTeamId);
    }
    
    await query(`
      INSERT INTO matches (matchday, home_team_id, away_team_id)
      VALUES ${values.join(', ')}
    `, params);
  }
  
  // Update season metadata
  await query(`
    UPDATE meta SET 
      data=jsonb_set(
        jsonb_set(
          jsonb_set(data, '{seasonNumber}', to_jsonb((data->>'seasonNumber')::int + 1)),
          '{currentMatchday}', '1'::jsonb
        ),
        '{status}', '"active"'::jsonb
      ),
      updated_at=NOW()
    WHERE key='season'
  `);
  
  // Generate new transfer market
  const market = generateTransferMarket(30);
  for(const p of market) await insertPlayer(p);
}

// ─── AI Transfers ───────────────────────────────────────────────────────────

async function aiTransferActions() {
  const aiClubs = await queryAll('SELECT * FROM clubs WHERE is_ai=TRUE');
  
  for(const club of aiClubs) {
    const squad = await queryAll('SELECT * FROM players WHERE club_id=$1', [club.id]);
    if(!squad.length) continue;

    if(Math.random() < 0.3) {
      const candidates = squad.filter(p => p.age > 29 || p.ovr < 60).sort((a,b) => a.ovr - b.ovr);
      if(candidates.length > 0) {
        await query('UPDATE players SET is_listed=TRUE, asking_price=$1 WHERE id=$2',
          [Math.round(candidates[0].value * 1.2), candidates[0].id]);
      }
    }

    if(club.transfer_budget > 1000000 && Math.random() < 0.4) {
      const market = await queryAll(`
        SELECT * FROM players WHERE club_id IS NULL AND is_listed=TRUE
      `);
      const avgOvr = squad.reduce((s,p) => s + p.ovr, 0) / squad.length;
      const target = market.filter(p => p.ovr > avgOvr - 3 && p.asking_price <= club.transfer_budget * 0.5)
        .sort((a,b) => b.ovr - a.ovr)[0];
      
      if(target && squad.length < 28) {
        const season = await getSeason();
        await transaction(async (client) => {
          await client.query('UPDATE players SET club_id=$1, is_listed=FALSE, asking_price=0 WHERE id=$2',
            [club.id, target.id]);
          await client.query('UPDATE clubs SET transfer_budget=transfer_budget-$1 WHERE id=$2',
            [target.asking_price, club.id]);
          await client.query(`
            INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday)
            VALUES ($1, NULL, $2, $3, $4)
          `, [target.id, club.id, target.asking_price, season.currentMatchday]);
        });
      }
    }
  }
}

// ─── Initialize Game ────────────────────────────────────────────────────────

async function initializeGame() {
  const existing = await queryOne('SELECT id FROM clubs LIMIT 1');
  if(existing) return;

  const clubIds = [];
  for(const data of CLUB_DATA) {
    const res = await query(`
      INSERT INTO clubs (name, short_name, stadium, city, balance, transfer_budget, wage_budget, reputation, is_ai, strength_tendency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
      RETURNING id
    `, [
      data.name, data.shortName, data.stadium, data.city,
      50000000 + Math.round(data.strength * 30000000),
      20000000 + Math.round(data.strength * 15000000),
      5000000 + Math.round(data.strength * 5000000),
      Math.round(data.strength * 100),
      data.strength
    ]);
    clubIds.push(res.rows[0].id);
  }

  for(let i = 0; i < clubIds.length; i++) {
    const squad = generateSquad(clubIds[i], Math.round(55 + CLUB_DATA[i].strength * 25));
    for(const p of squad) await insertPlayer(p);
  }

  const market = generateTransferMarket(50);
  for(const p of market) await insertPlayer(p);

  const fixtures = generateFixtures(clubIds);
  for(let i = 0; i < fixtures.length; i += 100) {
    const batch = fixtures.slice(i, i + 100);
    const values = [];
    const params = [];
    let idx = 1;
    for(const f of batch) {
      values.push(`($${idx++}, $${idx++}, $${idx++})`);
      params.push(f.matchday, f.homeTeamId, f.awayTeamId);
    }
    await query(`INSERT INTO matches (matchday, home_team_id, away_team_id) VALUES ${values.join(', ')}`, params);
  }

  // Season already initialized by schema.sql, but ensure it's correct
  const totalMatchdays = fixtures[fixtures.length - 1].matchday;
  await query(`
    UPDATE meta SET data=jsonb_set(data, '{totalMatchdays}', to_jsonb($1::int)) WHERE key='season'
  `, [totalMatchdays]);
}

// ─── Create User Club ───────────────────────────────────────────────────────

async function createUserClub(userId, clubName, stadium, city) {
  // Find weakest AI club to replace
  const weakest = await queryOne(`
    SELECT id FROM clubs WHERE is_ai=TRUE ORDER BY strength_tendency ASC LIMIT 1
  `);
  if(!weakest) throw new Error('No available clubs');

  await query(`
    UPDATE clubs SET 
      name=$1, short_name=$2, stadium=$3, city=$4,
      is_ai=FALSE, user_id=$5,
      balance=50000000, transfer_budget=25000000, wage_budget=6000000, reputation=50
    WHERE id=$6
  `, [clubName, clubName.substring(0,3).toUpperCase(), stadium, city, userId, weakest.id]);

  // Delete old squad
  await query('DELETE FROM players WHERE club_id=$1', [weakest.id]);

  // Generate new squad
  const squad = generateSquad(weakest.id, 65);
  for(const p of squad) await insertPlayer(p);

  // Link user to club
  await query('UPDATE users SET club_id=$1 WHERE id=$2', [weakest.id, userId]);

  return weakest.id;
}

// ─── Current Matchday Fixtures ──────────────────────────────────────────────

async function getCurrentMatchdayFixtures() {
  const season = await getSeason();
  return queryAll('SELECT * FROM matches WHERE matchday=$1', [season.currentMatchday]);
}

// ─── Auto-Simulation ────────────────────────────────────────────────────────

let autoSimTimer = null;
let autoAdvanceTimer = null;
let justAdvanced = false;
const AUTO_SIM_INTERVAL = 20000;
const AUTO_ADVANCE_DELAY = 30000;

function startAutoSimulation() {
  if(autoSimTimer) return;
  console.log('[AutoSim] Starting auto-simulation loop');
  autoSimTimer = setInterval(autoSimTick, AUTO_SIM_INTERVAL);
  setTimeout(autoSimTick, 3000);
}

function stopAutoSimulation() {
  if(autoSimTimer) { clearInterval(autoSimTimer); autoSimTimer = null; }
  if(autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  console.log('[AutoSim] Stopped');
}

async function autoSimTick() {
  try {
    if(justAdvanced) { justAdvanced = false; return; }
    const season = await getSeason();
    if(!season || season.status === 'finished') return;

    const unsim = await queryAll(`
      SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE
    `, [season.currentMatchday]);

    if(unsim.length > 0) {
      console.log(`[AutoSim] Simulating matchday ${season.currentMatchday} (${unsim.length} matches)`);
      await simulateMatchday(season.currentMatchday);
      await aiTransferActions();
      console.log(`[AutoSim] Matchday ${season.currentMatchday} complete`);

      if(autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = setTimeout(autoAdvanceTick, AUTO_ADVANCE_DELAY);
    }
  } catch(err) {
    console.error('[AutoSim] Error:', err.message);
  }
}

async function autoAdvanceTick() {
  try {
    const season = await getSeason();
    if(!season || season.status === 'finished') return;

    const unsim = await queryAll(`
      SELECT id FROM matches WHERE matchday=$1 AND simulated=FALSE
    `, [season.currentMatchday]);

    if(unsim.length > 0) return;

    // Deduct wages for user clubs
    const userClubs = await queryAll(`
      SELECT c.id, c.user_id FROM clubs c
      WHERE c.is_ai=FALSE AND c.user_id IS NOT NULL
    `);
    
    for(const club of userClubs) {
      const squad = await queryAll('SELECT salary FROM players WHERE club_id=$1', [club.id]);
      const totalWages = squad.reduce((s, p) => s + (p.salary || 0), 0);
      if(totalWages > 0) {
        await query('UPDATE clubs SET balance=balance-$1 WHERE id=$2', [totalWages, club.id]);
      }
    }

    const advanced = await advanceMatchday();
    if(advanced) {
      justAdvanced = true;
      const newSeason = await getSeason();
      console.log(`[AutoSim] Advanced to matchday ${newSeason.currentMatchday}`);
      
      // Notify user clubs
      for(const club of userClubs) {
        const match = await queryOne(`
          SELECT * FROM matches WHERE matchday=$1 AND (home_team_id=$2 OR away_team_id=$2)
        `, [newSeason.currentMatchday, club.id]);
        
        if(match) {
          const oppId = match.home_team_id === club.id ? match.away_team_id : match.home_team_id;
          const opp = await queryOne('SELECT name FROM clubs WHERE id=$1', [oppId]);
          const isHome = match.home_team_id === club.id;
          await createNotificationForUser(club.user_id, 'matchday',
            `Matchday ${newSeason.currentMatchday}`,
            `Next: ${isHome ? 'vs' : '@'} ${opp?.name || 'Unknown'}`
          );
        }
      }
    } else {
      console.log('[AutoSim] Season finished!');
      for(const club of userClubs) {
        const standings = await getStandings();
        const standing = standings.find(s => s.clubId === club.id);
        if(standing) {
          await createNotificationForUser(club.user_id, 'season_end',
            'Season Complete!',
            `Final position: ${standing.position}/${standings.length} with ${standing.points} points`
          );
        }
      }
    }
  } catch(err) {
    console.error('[AutoSim] Error advancing:', err.message);
  }
}

async function createNotificationForUser(userId, type, title, message) {
  await query(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES ($1, $2, $3, $4)
  `, [userId, type, title, message]);
}

module.exports = {
  initializeGame, createUserClub, generateFixtures, getStandings, getSeason,
  advanceMatchday, getCurrentMatchdayFixtures, simulateMatchday, aiTransferActions,
  startAutoSimulation, stopAutoSimulation, autoSimTick, autoAdvanceTick,
  calculateSeasonAwards, endOfSeason, CLUB_DATA
};
