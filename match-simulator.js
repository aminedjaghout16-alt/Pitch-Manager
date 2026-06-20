const { getDb } = require('./db');

// ─── Team Strength ────────────────────────────────────────────────────────────

async function getTeamStrength(clubId) {
  const db = getDb();
  const players = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ?', args: [clubId] })).rows;
  if (players.length === 0) return { attack: 50, defense: 50, midfield: 50, avgOvr: 50 };

  const best11 = selectBest11(players);
  const avgOvr = best11.reduce((sum, p) => sum + p.ovr, 0) / best11.length;
  const avgMorale = best11.reduce((sum, p) => sum + p.morale, 0) / best11.length / 100;
  const avgFitness = best11.reduce((sum, p) => sum + p.fitness, 0) / best11.length / 100;

  const attack = calcUnitStrength(best11, ['ST', 'LW', 'RW', 'CAM'], ['shooting', 'pace']);
  const midfield = calcUnitStrength(best11, ['CM', 'CDM', 'CAM'], ['passing', 'defending']);
  const defense = calcUnitStrength(best11, ['CB', 'LB', 'RB', 'GK'], ['defending', 'physical']);

  const moraleFactor = 0.8 + (avgMorale * 0.4);
  const fitnessFactor = 0.9 + (avgFitness * 0.2);

  return {
    attack: attack * moraleFactor * fitnessFactor,
    midfield: midfield * moraleFactor * fitnessFactor,
    defense: defense * moraleFactor * fitnessFactor,
    avgOvr: avgOvr * moraleFactor * fitnessFactor,
  };
}

function calcUnitStrength(players, positions, primaryAttrs) {
  const unitPlayers = players.filter(p => positions.includes(p.position));
  if (unitPlayers.length === 0) return 50;
  let total = 0;
  for (const p of unitPlayers) {
    let attrSum = 0;
    for (const attr of primaryAttrs) attrSum += p[attr] || 50;
    total += attrSum / primaryAttrs.length;
  }
  return total / unitPlayers.length;
}

function selectBest11(players) {
  const formation = { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, CAM: 0, LW: 1, RW: 1, ST: 1 };
  const selected = [];
  const used = new Set();

  for (const [pos, count] of Object.entries(formation)) {
    if (count === 0) continue;
    const candidates = players.filter(p => p.position === pos && !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      selected.push(candidates[i]);
      used.add(candidates[i].id);
    }
  }

  if (selected.length < 11) {
    const remaining = players.filter(p => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    for (const p of remaining) {
      if (selected.length >= 11) break;
      selected.push(p);
      used.add(p.id);
    }
  }

  return selected.slice(0, 11);
}

// ─── Match Simulation ─────────────────────────────────────────────────────────

function poisson(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

async function simulateMatch(homeTeamId, awayTeamId) {
  const homeStrength = await getTeamStrength(homeTeamId);
  const awayStrength = await getTeamStrength(awayTeamId);

  const HOME_ADVANTAGE = 1.12;
  const homeExpGoals = Math.max(0.3, (homeStrength.attack * HOME_ADVANTAGE) / Math.max(30, awayStrength.defense) * 1.2);
  const awayExpGoals = Math.max(0.2, awayStrength.attack / Math.max(30, homeStrength.defense) * 1.0);

  const homeLambda = Math.min(4.0, Math.max(0.3, homeExpGoals));
  const awayLambda = Math.min(3.5, Math.max(0.2, awayExpGoals));

  const homeGoals = poisson(homeLambda);
  const awayGoals = poisson(awayLambda);

  const events = await generateEvents(homeTeamId, awayTeamId, homeGoals, awayGoals);
  return { homeGoals, awayGoals, events };
}

async function generateEvents(homeTeamId, awayTeamId, homeGoals, awayGoals) {
  const db = getDb();
  const homePlayers = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ?', args: [homeTeamId] })).rows;
  const awayPlayers = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ?', args: [awayTeamId] })).rows;
  const events = [];

  for (let i = 0; i < homeGoals; i++) {
    const scorer = pickScorer(homePlayers);
    const assister = pickAssister(homePlayers, scorer);
    events.push({ type: 'goal', team: 'home', minute: rand(1, 90), player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown', player_id: scorer?.id, assist: assister ? `${assister.first_name} ${assister.last_name}` : null, assist_id: assister?.id });
  }

  for (let i = 0; i < awayGoals; i++) {
    const scorer = pickScorer(awayPlayers);
    const assister = pickAssister(awayPlayers, scorer);
    events.push({ type: 'goal', team: 'away', minute: rand(1, 90), player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown', player_id: scorer?.id, assist: assister ? `${assister.first_name} ${assister.last_name}` : null, assist_id: assister?.id });
  }

  for (let i = 0; i < rand(0, 3); i++) {
    const player = pickRandomPlayer(homePlayers);
    events.push({ type: 'yellow', team: 'home', minute: rand(1, 90), player: `${player.first_name} ${player.last_name}`, player_id: player.id });
  }
  for (let i = 0; i < rand(0, 3); i++) {
    const player = pickRandomPlayer(awayPlayers);
    events.push({ type: 'yellow', team: 'away', minute: rand(1, 90), player: `${player.first_name} ${player.last_name}`, player_id: player.id });
  }

  if (Math.random() < 0.1) {
    const team = Math.random() < 0.5 ? 'home' : 'away';
    const players = team === 'home' ? homePlayers : awayPlayers;
    const player = pickRandomPlayer(players);
    events.push({ type: 'red', team, minute: rand(20, 90), player: `${player.first_name} ${player.last_name}`, player_id: player.id });
  }

  events.sort((a, b) => a.minute - b.minute);
  return events;
}

function pickScorer(players) {
  const scorers = players.filter(p => ['ST', 'LW', 'RW', 'CAM', 'CM'].includes(p.position));
  const pool = scorers.length > 0 ? scorers : players;
  const weights = pool.map(p => p.shooting || 50);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function pickAssister(players, scorer) {
  const candidates = players.filter(p => p.id !== scorer?.id && ['CM', 'CAM', 'LW', 'RW', 'ST', 'LB', 'RB'].includes(p.position));
  if (candidates.length === 0) return null;
  const weights = candidates.map(p => p.passing || 50);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) { r -= weights[i]; if (r <= 0) return candidates[i]; }
  return candidates[candidates.length - 1];
}

function pickRandomPlayer(players) {
  return players[Math.floor(Math.random() * players.length)];
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Simulate Matchday ────────────────────────────────────────────────────────

async function simulateMatchday(matchday) {
  const db = getDb();
  const matches = (await db.execute({ sql: 'SELECT * FROM matches WHERE matchday = ? AND simulated = 0', args: [matchday] })).rows;

  const results = [];

  for (const match of matches) {
    const result = await simulateMatch(match.home_team_id, match.away_team_id);

    const homePoss = rand(35, 65);
    const awayPoss = 100 - homePoss;
    const homeShots = rand(5, 20);
    const awayShots = rand(5, 20);
    const homeShotsOT = Math.min(homeShots, rand(2, Math.max(2, result.homeGoals + 3)));
    const awayShotsOT = Math.min(awayShots, rand(2, Math.max(2, result.awayGoals + 3)));
    const homeCorners = rand(2, 10);
    const awayCorners = rand(2, 10);
    const homeFouls = rand(8, 18);
    const awayFouls = rand(8, 18);

    await db.execute({
      sql: `UPDATE matches SET home_goals = ?, away_goals = ?, simulated = 1, events = ?,
              home_possession = ?, away_possession = ?,
              home_shots = ?, away_shots = ?,
              home_shots_on_target = ?, away_shots_on_target = ?,
              home_corners = ?, away_corners = ?,
              home_fouls = ?, away_fouls = ?,
              played_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [
        result.homeGoals, result.awayGoals, JSON.stringify(result.events),
        homePoss, awayPoss, homeShots, awayShots,
        homeShotsOT, awayShotsOT, homeCorners, awayCorners,
        homeFouls, awayFouls, match.id
      ]
    });

    await updatePlayerStats(result.events, match.home_team_id, match.away_team_id);

    results.push({
      match_id: match.id,
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      ...result,
      stats: {
        home: { possession: homePoss, shots: homeShots, shotsOnTarget: homeShotsOT, corners: homeCorners, fouls: homeFouls },
        away: { possession: awayPoss, shots: awayShots, shotsOnTarget: awayShotsOT, corners: awayCorners, fouls: awayFouls }
      }
    });
  }

  await updateFitnessAfterMatchday();
  await processInjuries();

  return results;
}

async function updatePlayerStats(events, homeTeamId, awayTeamId) {
  const db = getDb();
  const stats = {};

  for (const event of events) {
    const playerId = event.player_id;
    if (!playerId) continue;
    if (!stats[playerId]) stats[playerId] = { goals: 0, assists: 0, yellows: 0, reds: 0 };

    if (event.type === 'goal') {
      stats[playerId].goals++;
      if (event.assist_id) {
        if (!stats[event.assist_id]) stats[event.assist_id] = { goals: 0, assists: 0, yellows: 0, reds: 0 };
        stats[event.assist_id].assists++;
      }
    } else if (event.type === 'yellow') {
      stats[playerId].yellows++;
    } else if (event.type === 'red') {
      stats[playerId].reds++;
    }
  }

  for (const [playerId, s] of Object.entries(stats)) {
    await db.execute({
      sql: 'UPDATE players SET goals = goals + ?, assists = assists + ? WHERE id = ?',
      args: [s.goals, s.assists, playerId]
    });
  }

  const homePlayers = (await db.execute({ sql: 'SELECT id FROM players WHERE club_id = ?', args: [homeTeamId] })).rows;
  const awayPlayers = (await db.execute({ sql: 'SELECT id FROM players WHERE club_id = ?', args: [awayTeamId] })).rows;

  for (const p of [...homePlayers, ...awayPlayers]) {
    await db.execute({ sql: 'UPDATE players SET appearances = appearances + 1 WHERE id = ?', args: [p.id] });
  }
}

async function processInjuries() {
  const db = getDb();
  await db.execute({ sql: 'UPDATE players SET injury_weeks = MAX(0, injury_weeks - 1) WHERE injury_weeks > 0' });
  await db.execute({ sql: "UPDATE players SET injury_type = NULL, injury_weeks = 0 WHERE injury_weeks = 0 AND injury_type IS NOT NULL" });

  const allPlayers = (await db.execute({ sql: 'SELECT id, fitness FROM players WHERE injury_type IS NULL' })).rows;
  const injuryTypes = ['Hamstring', 'Knock', 'Muscle strain', 'Ankle sprain', 'Thigh injury'];

  for (const player of allPlayers) {
    const injuryChance = player.fitness < 60 ? 0.05 : 0.02;
    if (Math.random() < injuryChance) {
      const injuryType = injuryTypes[Math.floor(Math.random() * injuryTypes.length)];
      const weeks = rand(1, 4);
      await db.execute({ sql: 'UPDATE players SET injury_type = ?, injury_weeks = ? WHERE id = ?', args: [injuryType, weeks, player.id] });
    }
  }
}

async function updateFitnessAfterMatchday() {
  const db = getDb();
  await db.execute({
    sql: 'UPDATE players SET fitness = MAX(50, fitness - (ABS(RANDOM()) % 10) - 3) WHERE club_id IN (SELECT id FROM clubs)'
  });
}

module.exports = {
  simulateMatch,
  simulateMatchday,
  getTeamStrength,
  selectBest11,
};
