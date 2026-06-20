const db = require('./db');
const { generateSquad, insertPlayer, generateTransferMarket } = require('./player-generator');
const { simulateMatchday } = require('./match-simulator');

// ─── Club Data ───────────────────────────────────────────────────────────────
const CLUB_DATA = [
  { name: 'Greenfield United', short_name: 'GRN', stadium: 'Greenfield Arena', city: 'Greenfield', strength: 0.9 },
  { name: 'Royal Sporting', short_name: 'ROY', stadium: 'Royal Park', city: 'Kingsbury', strength: 0.85 },
  { name: 'Northbridge FC', short_name: 'NBR', stadium: 'Northbridge Stadium', city: 'Northbridge', strength: 0.8 },
  { name: 'Westwood City', short_name: 'WST', stadium: 'Westwood Ground', city: 'Westwood', strength: 0.75 },
  { name: 'Eastham Rovers', short_name: 'EAH', stadium: 'Eastham Park', city: 'Eastham', strength: 0.7 },
  { name: 'Southgate Athletic', short_name: 'SGA', stadium: 'Southgate Stadium', city: 'Southgate', strength: 0.65 },
  { name: 'Ironville Town', short_name: 'IRN', stadium: 'Iron Works', city: 'Ironville', strength: 0.6 },
  { name: 'Lakeside FC', short_name: 'LAK', stadium: 'Lakeview Arena', city: 'Lakeside', strength: 0.55 },
  { name: 'Stormborough FC', short_name: 'STM', stadium: 'Storm Park', city: 'Stormborough', strength: 0.5 },
  { name: 'Fairview United', short_name: 'FRV', stadium: 'Fairview Ground', city: 'Fairview', strength: 0.5 },
  { name: 'Crestwood FC', short_name: 'CRS', stadium: 'Crestwood Stadium', city: 'Crestwood', strength: 0.45 },
  { name: 'Ashford Wanderers', short_name: 'ASH', stadium: 'Ashford Lane', city: 'Ashford', strength: 0.45 },
  { name: 'Brighton Athletic', short_name: 'BRI', stadium: 'Brighton Park', city: 'Brighton', strength: 0.4 },
  { name: 'Dunmore FC', short_name: 'DUN', stadium: 'Dunmore Arena', city: 'Dunmore', strength: 0.4 },
  { name: 'Elkstone Rovers', short_name: 'ELK', stadium: 'Elkstone Ground', city: 'Elkstone', strength: 0.35 },
  { name: 'Foxwood City', short_name: 'FOX', stadium: 'Foxwood Stadium', city: 'Foxwood', strength: 0.35 },
  { name: 'Hartley United', short_name: 'HRT', stadium: 'Hartley Park', city: 'Hartley', strength: 0.3 },
  { name: 'Kingsway FC', short_name: 'KNG', stadium: 'Kingsway Arena', city: 'Kingsway', strength: 0.3 },
  { name: 'Millfield Town', short_name: 'MIL', stadium: 'Millfield Ground', city: 'Millfield', strength: 0.25 },
  { name: 'Oakdale FC', short_name: 'OAK', stadium: 'Oakdale Stadium', city: 'Oakdale', strength: 0.25 },
];

// ─── Fixture Generation (Round-Robin) ────────────────────────────────────────

/**
 * Generate a double round-robin fixture list for N teams
 * Returns array of { matchday, home_team_id, away_team_id }
 */
function generateFixtures(teamIds) {
  const n = teamIds.length;
  const fixtures = [];

  // Round-robin algorithm (circle method)
  const teams = [...teamIds];
  const halfSize = n / 2;

  // First half of season (matchdays 1 to n-1)
  for (let round = 0; round < n - 1; round++) {
    const matchday = round + 1;
    for (let i = 0; i < halfSize; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      // Alternate home/away for fairness
      if (round % 2 === 0) {
        fixtures.push({ matchday, home_team_id: home, away_team_id: away });
      } else {
        fixtures.push({ matchday, home_team_id: away, away_team_id: home });
      }
    }
    // Rotate (fix first team, rotate rest)
    teams.splice(1, 0, teams.pop());
  }

  // Second half: reverse home/away
  const secondHalfOffset = n - 1;
  for (const f of [...fixtures]) {
    fixtures.push({
      matchday: f.matchday + secondHalfOffset,
      home_team_id: f.away_team_id,
      away_team_id: f.home_team_id,
    });
  }

  return fixtures;
}

// ─── League Standings ────────────────────────────────────────────────────────

function getStandings() {
  const clubs = db.prepare('SELECT id, name, short_name FROM clubs').all();
  const standings = {};

  for (const club of clubs) {
    standings[club.id] = {
      club_id: club.id,
      name: club.name,
      short_name: club.short_name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    };
  }

  const matches = db.prepare('SELECT * FROM matches WHERE simulated = 1').all();

  for (const match of matches) {
    const home = standings[match.home_team_id];
    const away = standings[match.away_team_id];
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goals_for += match.home_goals;
    home.goals_against += match.away_goals;
    away.goals_for += match.away_goals;
    away.goals_against += match.home_goals;

    if (match.home_goals > match.away_goals) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (match.home_goals < match.away_goals) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
    }
  }

  // Calculate goal difference and sort
  const table = Object.values(standings);
  for (const row of table) {
    row.goal_difference = row.goals_for - row.goals_against;
  }

  table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    return b.goals_for - a.goals_for;
  });

  // Add position
  table.forEach((row, i) => { row.position = i + 1; });

  return table;
}

// ─── Season Management ───────────────────────────────────────────────────────

function getSeason() {
  return db.prepare('SELECT * FROM season WHERE id = 1').get();
}

function advanceMatchday() {
  const season = getSeason();
  if (season.current_matchday >= season.total_matchdays) {
    db.prepare('UPDATE season SET status = ? WHERE id = 1').run('finished');
    return false;
  }
  db.prepare('UPDATE season SET current_matchday = current_matchday + 1 WHERE id = 1').run();
  return true;
}

function getCurrentMatchdayFixtures() {
  const season = getSeason();
  return db.prepare('SELECT * FROM matches WHERE matchday = ?').all(season.current_matchday);
}

// ─── AI Club Management ──────────────────────────────────────────────────────

function aiTransferActions() {
  const aiClubs = db.prepare('SELECT * FROM clubs WHERE is_ai = 1').all();

  for (const club of aiClubs) {
    // AI may list some players for sale
    const squad = db.prepare('SELECT * FROM players WHERE club_id = ?').all(club.id);
    if (squad.length === 0) continue;

    // List 0-2 players for sale
    const toList = Math.random() < 0.3 ? 1 : 0;
    if (toList > 0) {
      // List older or lower-rated players
      const candidates = squad
        .filter(p => p.age > 29 || p.ovr < 60)
        .sort((a, b) => a.ovr - b.ovr);

      if (candidates.length > 0) {
        const player = candidates[0];
        db.prepare('UPDATE players SET is_listed = 1, asking_price = ? WHERE id = ?')
          .run(Math.round(player.value * 1.2), player.id);
      }
    }

    // AI may buy players from transfer market
    if (club.transfer_budget > 1000000 && Math.random() < 0.4) {
      const marketPlayers = db.prepare('SELECT * FROM players WHERE club_id = 0 AND is_listed = 1').all();
      const avgSquadOvr = squad.reduce((sum, p) => sum + p.ovr, 0) / squad.length;

      // Look for players better than squad average
      const targets = marketPlayers
        .filter(p => p.ovr > avgSquadOvr - 3 && p.asking_price <= club.transfer_budget * 0.5)
        .sort((a, b) => b.ovr - a.ovr);

      if (targets.length > 0 && squad.length < 28) {
        const target = targets[0];
        if (club.transfer_budget >= target.asking_price) {
          buyPlayerForAI(club.id, target.id, target.asking_price);
        }
      }
    }
  }
}

function buyPlayerForAI(clubId, playerId, price) {
  const season = getSeason();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return;

  const fromClubId = player.club_id;

  db.transaction(() => {
    // Transfer player
    db.prepare('UPDATE players SET club_id = ?, is_listed = 0, asking_price = 0 WHERE id = ?')
      .run(clubId, playerId);

    // Update club finances
    db.prepare('UPDATE clubs SET transfer_budget = transfer_budget - ? WHERE id = ?')
      .run(price, clubId);
    if (fromClubId !== 0) {
      db.prepare('UPDATE clubs SET balance = balance + ?, transfer_budget = transfer_budget + ? WHERE id = ?')
        .run(price, price, fromClubId);
    }

    // Record transfer
    db.prepare(`
      INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday)
      VALUES (?, ?, ?, ?, ?)
    `).run(playerId, fromClubId, clubId, price, season.current_matchday);
  })();
}

// ─── Game Initialization ─────────────────────────────────────────────────────

function initializeGame() {
  const existingClubs = db.prepare('SELECT COUNT(*) as count FROM clubs').get();
  if (existingClubs.count > 0) return; // Already initialized

  const insertClub = db.transaction(() => {
    // Create all clubs
    const clubIds = [];
    for (const data of CLUB_DATA) {
      const result = db.prepare(`
        INSERT INTO clubs (name, short_name, stadium, city, balance, transfer_budget, wage_budget, reputation, is_ai, strength_tendency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(data.name, data.short_name, data.stadium, data.city,
        50000000 + Math.round(data.strength * 30000000),
        20000000 + Math.round(data.strength * 15000000),
        5000000 + Math.round(data.strength * 5000000),
        Math.round(data.strength * 100),
        data.strength
      );
      clubIds.push(result.lastInsertRowid);
    }

    // Generate squads for each club
    for (let i = 0; i < clubIds.length; i++) {
      const avgOvr = Math.round(55 + CLUB_DATA[i].strength * 25);
      const squad = generateSquad(clubIds[i], avgOvr);
      for (const player of squad) {
        insertPlayer(player);
      }
    }

    // Generate transfer market
    const marketPlayers = generateTransferMarket(50);
    for (const player of marketPlayers) {
      insertPlayer(player);
    }

    // Generate fixtures
    const fixtures = generateFixtures(clubIds);
    const insertMatch = db.prepare(`
      INSERT INTO matches (matchday, home_team_id, away_team_id)
      VALUES (@matchday, @home_team_id, @away_team_id)
    `);
    for (const fixture of fixtures) {
      insertMatch.run(fixture);
    }
  });

  insertClub();
}

/**
 * Create a user club (replaces one of the AI clubs or adds a new one)
 */
function createUserClub(userId, clubName, stadium, city) {
  // Replace the weakest AI club (last one) with user's club
  const weakestClub = db.prepare('SELECT * FROM clubs WHERE is_ai = 1 ORDER BY strength_tendency ASC LIMIT 1').get();

  if (!weakestClub) throw new Error('No available clubs for user');

  return db.transaction(() => {
    // Update the club to be user-controlled
    db.prepare(`
      UPDATE clubs SET name = ?, short_name = ?, stadium = ?, city = ?, is_ai = 0,
        balance = 50000000, transfer_budget = 25000000, wage_budget = 6000000, reputation = 50
      WHERE id = ?
    `).run(clubName, clubName.substring(0, 3).toUpperCase(), stadium, city, weakestClub.id);

    // Regenerate squad with balanced OVR
    db.prepare('DELETE FROM players WHERE club_id = ?').run(weakestClub.id);
    const squad = generateSquad(weakestClub.id, 65);
    for (const player of squad) {
      insertPlayer(player);
    }

    // Link user to club
    db.prepare('UPDATE users SET club_id = ? WHERE id = ?').run(weakestClub.id, userId);

    return weakestClub.id;
  })();
}

module.exports = {
  initializeGame,
  createUserClub,
  generateFixtures,
  getStandings,
  getSeason,
  advanceMatchday,
  getCurrentMatchdayFixtures,
  simulateMatchday,
  aiTransferActions,
  CLUB_DATA,
};
