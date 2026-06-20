const { getDb } = require('./db');
const { generateSquad, insertPlayer, generateTransferMarket } = require('./player-generator');
const { simulateMatchday } = require('./match-simulator');

// ─── Club Data ────────────────────────────────────────────────────────────────
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

// ─── Fixture Generation ───────────────────────────────────────────────────────
function generateFixtures(teamIds) {
  const n = teamIds.length;
  const fixtures = [];
  const teams = [...teamIds];
  const halfSize = n / 2;

  for (let round = 0; round < n - 1; round++) {
    const matchday = round + 1;
    for (let i = 0; i < halfSize; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      if (round % 2 === 0) {
        fixtures.push({ matchday, home_team_id: home, away_team_id: away });
      } else {
        fixtures.push({ matchday, home_team_id: away, away_team_id: home });
      }
    }
    teams.splice(1, 0, teams.pop());
  }

  const secondHalfOffset = n - 1;
  for (const f of [...fixtures]) {
    fixtures.push({ matchday: f.matchday + secondHalfOffset, home_team_id: f.away_team_id, away_team_id: f.home_team_id });
  }

  return fixtures;
}

// ─── Standings ────────────────────────────────────────────────────────────────
async function getStandings() {
  const db = getDb();
  const clubs = (await db.execute('SELECT id, name, short_name FROM clubs')).rows;
  const standings = {};

  for (const club of clubs) {
    standings[club.id] = { club_id: club.id, name: club.name, short_name: club.short_name, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 };
  }

  const matches = (await db.execute('SELECT * FROM matches WHERE simulated = 1')).rows;

  for (const match of matches) {
    const home = standings[match.home_team_id];
    const away = standings[match.away_team_id];
    if (!home || !away) continue;

    home.played++; away.played++;
    home.goals_for += match.home_goals;
    home.goals_against += match.away_goals;
    away.goals_for += match.away_goals;
    away.goals_against += match.home_goals;

    if (match.home_goals > match.away_goals) { home.won++; home.points += 3; away.lost++; }
    else if (match.home_goals < match.away_goals) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points += 1; away.points += 1; }
  }

  const table = Object.values(standings);
  for (const row of table) row.goal_difference = row.goals_for - row.goals_against;

  table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    return b.goals_for - a.goals_for;
  });

  table.forEach((row, i) => { row.position = i + 1; });
  return table;
}

// ─── Season ───────────────────────────────────────────────────────────────────
async function getSeason() {
  const db = getDb();
  return (await db.execute('SELECT * FROM season WHERE id = 1')).rows[0];
}

async function advanceMatchday() {
  const db = getDb();
  const season = await getSeason();
  if (season.current_matchday >= season.total_matchdays) {
    await db.execute({ sql: "UPDATE season SET status = 'finished' WHERE id = 1" });
    return false;
  }
  await db.execute('UPDATE season SET current_matchday = current_matchday + 1 WHERE id = 1');
  return true;
}

async function getCurrentMatchdayFixtures() {
  const db = getDb();
  const season = await getSeason();
  return (await db.execute({ sql: 'SELECT * FROM matches WHERE matchday = ?', args: [season.current_matchday] })).rows;
}

// ─── AI Club Management ───────────────────────────────────────────────────────
async function aiTransferActions() {
  const db = getDb();
  const aiClubs = (await db.execute('SELECT * FROM clubs WHERE is_ai = 1')).rows;

  for (const club of aiClubs) {
    const squad = (await db.execute({ sql: 'SELECT * FROM players WHERE club_id = ?', args: [club.id] })).rows;
    if (squad.length === 0) continue;

    if (Math.random() < 0.3) {
      const candidates = squad.filter(p => p.age > 29 || p.ovr < 60).sort((a, b) => a.ovr - b.ovr);
      if (candidates.length > 0) {
        const player = candidates[0];
        await db.execute({
          sql: 'UPDATE players SET is_listed = 1, asking_price = ? WHERE id = ?',
          args: [Math.round(player.value * 1.2), player.id]
        });
      }
    }

    if (club.transfer_budget > 1000000 && Math.random() < 0.4) {
      const marketPlayers = (await db.execute('SELECT * FROM players WHERE club_id = 0 AND is_listed = 1')).rows;
      const avgSquadOvr = squad.reduce((sum, p) => sum + p.ovr, 0) / squad.length;
      const targets = marketPlayers
        .filter(p => p.ovr > avgSquadOvr - 3 && p.asking_price <= club.transfer_budget * 0.5)
        .sort((a, b) => b.ovr - a.ovr);

      if (targets.length > 0 && squad.length < 28) {
        const target = targets[0];
        if (club.transfer_budget >= target.asking_price) {
          await buyPlayerForAI(club.id, target.id, target.asking_price);
        }
      }
    }
  }
}

async function buyPlayerForAI(clubId, playerId, price) {
  const db = getDb();
  const player = (await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [playerId] })).rows[0];
  if (!player) return;

  const fromClubId = player.club_id;
  const season = await getSeason();

  await db.execute({ sql: 'UPDATE players SET club_id = ?, is_listed = 0, asking_price = 0 WHERE id = ?', args: [clubId, playerId] });
  await db.execute({ sql: 'UPDATE clubs SET transfer_budget = transfer_budget - ? WHERE id = ?', args: [price, clubId] });

  if (fromClubId !== 0) {
    await db.execute({ sql: 'UPDATE clubs SET balance = balance + ?, transfer_budget = transfer_budget + ? WHERE id = ?', args: [price, price, fromClubId] });
  }

  await db.execute({
    sql: 'INSERT INTO transfers (player_id, from_club_id, to_club_id, fee, matchday) VALUES (?, ?, ?, ?, ?)',
    args: [playerId, fromClubId, clubId, price, season.current_matchday]
  });
}

// ─── Game Initialization ──────────────────────────────────────────────────────
async function initializeGame() {
  const db = getDb();
  const existing = (await db.execute('SELECT COUNT(*) as count FROM clubs')).rows[0];
  if (existing.count > 0) return; // Already initialized

  const clubIds = [];

  for (const data of CLUB_DATA) {
    const result = await db.execute({
      sql: `INSERT INTO clubs (name, short_name, stadium, city, balance, transfer_budget, wage_budget, reputation, is_ai, strength_tendency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [
        data.name, data.short_name, data.stadium, data.city,
        50000000 + Math.round(data.strength * 30000000),
        20000000 + Math.round(data.strength * 15000000),
        5000000 + Math.round(data.strength * 5000000),
        Math.round(data.strength * 100),
        data.strength
      ]
    });
    clubIds.push(Number(result.lastInsertRowid));
  }

  // Generate squads
  for (let i = 0; i < clubIds.length; i++) {
    const avgOvr = Math.round(55 + CLUB_DATA[i].strength * 25);
    const squad = generateSquad(clubIds[i], avgOvr);
    for (const player of squad) {
      await insertPlayer(player);
    }
  }

  // Generate transfer market
  const marketPlayers = generateTransferMarket(50);
  for (const player of marketPlayers) {
    await insertPlayer(player);
  }

  // Generate fixtures
  const fixtures = generateFixtures(clubIds);
  for (const fixture of fixtures) {
    await db.execute({
      sql: 'INSERT INTO matches (matchday, home_team_id, away_team_id) VALUES (?, ?, ?)',
      args: [fixture.matchday, fixture.home_team_id, fixture.away_team_id]
    });
  }

  // Initialize season
  await db.execute({
    sql: 'INSERT OR IGNORE INTO season (id, season_number, current_matchday, total_matchdays, status) VALUES (1, 1, 1, ?, "active")',
    args: [fixtures[fixtures.length - 1].matchday]
  });
}

async function createUserClub(userId, clubName, stadium, city) {
  const db = getDb();
  const weakest = (await db.execute('SELECT * FROM clubs WHERE is_ai = 1 ORDER BY strength_tendency ASC LIMIT 1')).rows[0];
  if (!weakest) throw new Error('No available clubs for user');

  await db.execute({
    sql: `UPDATE clubs SET name = ?, short_name = ?, stadium = ?, city = ?, is_ai = 0,
            balance = 50000000, transfer_budget = 25000000, wage_budget = 6000000, reputation = 50
          WHERE id = ?`,
    args: [clubName, clubName.substring(0, 3).toUpperCase(), stadium, city, weakest.id]
  });

  await db.execute({ sql: 'DELETE FROM players WHERE club_id = ?', args: [weakest.id] });

  const squad = generateSquad(weakest.id, 65);
  for (const player of squad) {
    await insertPlayer(player);
  }

  await db.execute({ sql: 'UPDATE users SET club_id = ? WHERE id = ?', args: [weakest.id, userId] });

  return weakest.id;
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
