const db = require('./db');

// ─── Match Simulation Engine ─────────────────────────────────────────────────

/**
 * Calculate team strength based on player OVR, formation, morale, fitness
 */
function getTeamStrength(clubId) {
  const players = db.prepare('SELECT * FROM players WHERE club_id = ?').all(clubId);
  if (players.length === 0) return { attack: 50, defense: 50, midfield: 50, avgOvr: 50 };

  // Pick best 11 by position (simplified 4-3-3)
  const best11 = selectBest11(players);
  const avgOvr = best11.reduce((sum, p) => sum + p.ovr, 0) / best11.length;
  const avgMorale = best11.reduce((sum, p) => sum + p.morale, 0) / best11.length / 100;
  const avgFitness = best11.reduce((sum, p) => sum + p.fitness, 0) / best11.length / 100;

  // Calculate unit strengths
  const attack = calcUnitStrength(best11, ['ST', 'LW', 'RW', 'CAM'], ['shooting', 'pace']);
  const midfield = calcUnitStrength(best11, ['CM', 'CDM', 'CAM'], ['passing', 'defending']);
  const defense = calcUnitStrength(best11, ['CB', 'LB', 'RB', 'GK'], ['defending', 'physical']);

  const moraleFactor = 0.8 + (avgMorale * 0.4); // 0.8 to 1.2
  const fitnessFactor = 0.9 + (avgFitness * 0.2); // 0.9 to 1.1

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
    for (const attr of primaryAttrs) {
      attrSum += p[attr] || 50;
    }
    total += attrSum / primaryAttrs.length;
  }
  return total / unitPlayers.length;
}

/**
 * Select best 11 players in a 4-3-3 formation
 */
function selectBest11(players) {
  const formation = {
    GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, CAM: 0, LW: 1, RW: 1, ST: 1
  };

  const selected = [];
  const used = new Set();

  // Fill each position with best available player
  for (const [pos, count] of Object.entries(formation)) {
    if (count === 0) continue;
    const candidates = players
      .filter(p => p.position === pos && !used.has(p.id))
      .sort((a, b) => b.ovr - a.ovr);

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      selected.push(candidates[i]);
      used.add(candidates[i].id);
    }
  }

  // Fill remaining spots with best available
  if (selected.length < 11) {
    const remaining = players
      .filter(p => !used.has(p.id))
      .sort((a, b) => b.ovr - a.ovr);

    for (const p of remaining) {
      if (selected.length >= 11) break;
      selected.push(p);
      used.add(p.id);
    }
  }

  return selected.slice(0, 11);
}

/**
 * Poisson random variable
 */
function poisson(lambda) {
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

/**
 * Simulate a single match
 * Returns { homeGoals, awayGoals, events[] }
 */
function simulateMatch(homeTeamId, awayTeamId) {
  const homeStrength = getTeamStrength(homeTeamId);
  const awayStrength = getTeamStrength(awayTeamId);

  // Home advantage factor
  const HOME_ADVANTAGE = 1.12;

  // Expected goals based on attack vs defense
  const homeExpGoals = Math.max(0.3,
    (homeStrength.attack * HOME_ADVANTAGE) / Math.max(30, awayStrength.defense) * 1.2
  );
  const awayExpGoals = Math.max(0.2,
    awayStrength.attack / Math.max(30, homeStrength.defense) * 1.0
  );

  // Clamp expected goals to reasonable range
  const homeLambda = Math.min(4.0, Math.max(0.3, homeExpGoals));
  const awayLambda = Math.min(3.5, Math.max(0.2, awayExpGoals));

  const homeGoals = poisson(homeLambda);
  const awayGoals = poisson(awayLambda);

  // Generate match events
  const events = generateEvents(homeTeamId, awayTeamId, homeGoals, awayGoals);

  return { homeGoals, awayGoals, events };
}

/**
 * Generate match events (goals with assists, cards)
 */
function generateEvents(homeTeamId, awayTeamId, homeGoals, awayGoals) {
  const events = [];
  const homePlayers = db.prepare('SELECT * FROM players WHERE club_id = ?').all(homeTeamId);
  const awayPlayers = db.prepare('SELECT * FROM players WHERE club_id = ?').all(awayTeamId);

  // Home goals
  for (let i = 0; i < homeGoals; i++) {
    const minute = rand(1, 90);
    const scorer = pickScorer(homePlayers);
    const assister = pickAssister(homePlayers, scorer);
    events.push({
      type: 'goal',
      team: 'home',
      minute,
      player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown',
      player_id: scorer?.id,
      assist: assister ? `${assister.first_name} ${assister.last_name}` : null,
      assist_id: assister?.id,
    });
  }

  // Away goals
  for (let i = 0; i < awayGoals; i++) {
    const minute = rand(1, 90);
    const scorer = pickScorer(awayPlayers);
    const assister = pickAssister(awayPlayers, scorer);
    events.push({
      type: 'goal',
      team: 'away',
      minute,
      player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown',
      player_id: scorer?.id,
      assist: assister ? `${assister.first_name} ${assister.last_name}` : null,
      assist_id: assister?.id,
    });
  }

  // Yellow cards (0-3 per team)
  const homeYellows = rand(0, 3);
  const awayYellows = rand(0, 3);
  for (let i = 0; i < homeYellows; i++) {
    const minute = rand(1, 90);
    const player = pickRandomPlayer(homePlayers);
    events.push({
      type: 'yellow',
      team: 'home',
      minute,
      player: `${player.first_name} ${player.last_name}`,
      player_id: player.id,
    });
  }
  for (let i = 0; i < awayYellows; i++) {
    const minute = rand(1, 90);
    const player = pickRandomPlayer(awayPlayers);
    events.push({
      type: 'yellow',
      team: 'away',
      minute,
      player: `${player.first_name} ${player.last_name}`,
      player_id: player.id,
    });
  }

  // Red cards (rare, 0-1 per team)
  if (Math.random() < 0.1) {
    const minute = rand(20, 90);
    const team = Math.random() < 0.5 ? 'home' : 'away';
    const players = team === 'home' ? homePlayers : awayPlayers;
    const player = pickRandomPlayer(players);
    events.push({
      type: 'red',
      team,
      minute,
      player: `${player.first_name} ${player.last_name}`,
      player_id: player.id,
    });
  }

  // Sort by minute
  events.sort((a, b) => a.minute - b.minute);
  return events;
}

function pickAssister(players, scorer) {
  // Assisters are typically midfielders or attackers
  const candidates = players.filter(p =>
    p.id !== scorer?.id &&
    ['CM', 'CAM', 'LW', 'RW', 'ST', 'LB', 'RB'].includes(p.position)
  );
  if (candidates.length === 0) return null;
  // Weight by passing attribute
  const weights = candidates.map(p => p.passing || 50);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function pickRandomPlayer(players) {
  return players[Math.floor(Math.random() * players.length)];
}

function pickScorer(players) {
  // Attackers more likely to score
  const scorers = players.filter(p =>
    ['ST', 'LW', 'RW', 'CAM', 'CM'].includes(p.position)
  );
  const pool = scorers.length > 0 ? scorers : players;

  // Weight by shooting attribute
  const weights = pool.map(p => p.shooting || 50);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulate all matches for a matchday
 */
function simulateMatchday(matchday) {
  const matches = db.prepare(
    'SELECT * FROM matches WHERE matchday = ? AND simulated = 0'
  ).all(matchday);

  const results = [];
  const updateStmt = db.prepare(`
    UPDATE matches SET home_goals = ?, away_goals = ?, simulated = 1, events = ?,
      home_possession = ?, away_possession = ?,
      home_shots = ?, away_shots = ?,
      home_shots_on_target = ?, away_shots_on_target = ?,
      home_corners = ?, away_corners = ?,
      home_fouls = ?, away_fouls = ?,
      played_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const simulateAll = db.transaction(() => {
    for (const match of matches) {
      const result = simulateMatch(match.home_team_id, match.away_team_id);

      // Generate match statistics
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

      updateStmt.run(
        result.homeGoals,
        result.awayGoals,
        JSON.stringify(result.events),
        homePoss, awayPoss,
        homeShots, awayShots,
        homeShotsOT, awayShotsOT,
        homeCorners, awayCorners,
        homeFouls, awayFouls,
        match.id
      );

      // Update player stats
      updatePlayerStats(result.events, match.home_team_id, match.away_team_id);

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
  });

  simulateAll();

  // Update player fitness and handle injuries after matchday
  updateFitnessAfterMatchday();
  processInjuries();

  return results;
}

/**
 * Update player stats (goals, assists, cards, appearances)
 */
function updatePlayerStats(events, homeTeamId, awayTeamId) {
  const updateStmt = db.prepare(`
    UPDATE players SET
      goals = goals + ?,
      assists = assists + ?,
      yellow_cards = yellow_cards + ?,
      red_cards = red_cards + ?,
      appearances = appearances + 1
    WHERE id = ?
  `);

  // Track stats per player
  const stats = {};

  for (const event of events) {
    const playerId = event.player_id;
    if (!playerId) continue;

    if (!stats[playerId]) {
      stats[playerId] = { goals: 0, assists: 0, yellows: 0, reds: 0 };
    }

    if (event.type === 'goal') {
      stats[playerId].goals++;
      if (event.assist_id) {
        if (!stats[event.assist_id]) {
          stats[event.assist_id] = { goals: 0, assists: 0, yellows: 0, reds: 0 };
        }
        stats[event.assist_id].assists++;
      }
    } else if (event.type === 'yellow') {
      stats[playerId].yellows++;
    } else if (event.type === 'red') {
      stats[playerId].reds++;
    }
  }

  // Update database
  for (const [playerId, s] of Object.entries(stats)) {
    updateStmt.run(s.goals, s.assists, s.yellows, s.reds, playerId);
  }

  // Update appearances for all players who played (simplified: all players in squad)
  const homePlayers = db.prepare('SELECT id FROM players WHERE club_id = ?').all(homeTeamId);
  const awayPlayers = db.prepare('SELECT id FROM players WHERE club_id = ?').all(awayTeamId);
  const allPlayers = [...homePlayers, ...awayPlayers];

  const appStmt = db.prepare('UPDATE players SET appearances = appearances + 1 WHERE id = ?');
  for (const p of allPlayers) {
    if (!stats[p.id]) {
      appStmt.run(p.id);
    }
  }
}

/**
 * Process injuries - reduce injury weeks, check for new injuries
 */
function processInjuries() {
  // Reduce injury weeks
  db.prepare(`
    UPDATE players SET injury_weeks = MAX(0, injury_weeks - 1)
    WHERE injury_weeks > 0
  `).run();

  // Clear injuries that have healed
  db.prepare(`
    UPDATE players SET injury_type = NULL, injury_weeks = 0
    WHERE injury_weeks = 0 AND injury_type IS NOT NULL
  `).run();

  // Random chance of new injuries (2-5% of players)
  const allPlayers = db.prepare('SELECT id, fitness FROM players WHERE injury_type IS NULL').all();
  const injuryTypes = ['Hamstring', 'Knock', 'Muscle strain', 'Ankle sprain', 'Thigh injury'];

  for (const player of allPlayers) {
    const injuryChance = player.fitness < 60 ? 0.05 : 0.02;
    if (Math.random() < injuryChance) {
      const injuryType = injuryTypes[Math.floor(Math.random() * injuryTypes.length)];
      const weeks = rand(1, 4);
      db.prepare('UPDATE players SET injury_type = ?, injury_weeks = ? WHERE id = ?')
        .run(injuryType, weeks, player.id);
    }
  }

  // Process suspensions (players with 2+ yellow cards get 1 match ban)
  db.prepare(`
    UPDATE players SET suspended = 1
    WHERE yellow_cards >= 2 AND suspended = 0
  `).run();
}

/**
 * Reduce player fitness after a matchday
 */
function updateFitnessAfterMatchday() {
  db.prepare(`
    UPDATE players SET fitness = MAX(50, fitness - RANDOM() % 10 - 3)
    WHERE club_id IN (SELECT id FROM clubs)
  `).run();
}

module.exports = {
  simulateMatch,
  simulateMatchday,
  getTeamStrength,
  selectBest11,
};
