const { getDb, useLocalDB, FieldValue } = require('./db');
const { generateSquad, insertPlayer, generateTransferMarket, calculateValue, calculateSalary } = require('./player-generator');
const { simulateMatchday } = require('./match-simulator');

// Use FieldValue from db module for local dev, or firebase-admin for production
const admin = useLocalDB ? { firestore: { FieldValue } } : require('firebase-admin');

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

function generateFixtures(teamIds) {
  const n = teamIds.length, fixtures = [], teams = [...teamIds], half = Math.floor(n/2);
  // First leg
  for(let r=0;r<n-1;r++){
    const md=r+1;
    for(let i=0;i<half;i++){
      const h=teams[i],a=teams[n-1-i];
      // Safety: never let a club play itself
      if(h===a) continue;
      fixtures.push(r%2===0?{matchday:md,homeTeamId:h,awayTeamId:a}:{matchday:md,homeTeamId:a,awayTeamId:h});
    }
    teams.splice(1,0,teams.pop());
  }
  // Second leg (reverse home/away)
  const off=n-1;
  const firstLeg=[...fixtures];
  for(const f of firstLeg){
    // Safety check again for reverse leg
    if(f.homeTeamId===f.awayTeamId) continue;
    fixtures.push({matchday:f.matchday+off,homeTeamId:f.awayTeamId,awayTeamId:f.homeTeamId});
  }
  // Validate: no self-play, no duplicate fixtures on same matchday
  const validated = fixtures.filter(f => f.homeTeamId && f.awayTeamId && f.homeTeamId !== f.awayTeamId);
  return validated;
}

async function getStandings() {
  const db = getDb();
  const [clubsSnap, matchesSnap] = await Promise.all([
    db.collection('clubs').get(),
    db.collection('matches').where('simulated','==',true).get(),
  ]);

  const standings = {};
  clubsSnap.docs.forEach(d => {
    const c = d.data();
    standings[d.id] = {clubId:d.id,name:c.name,shortName:c.shortName,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0};
  });

  matchesSnap.docs.forEach(d => {
    const m = d.data();
    const h = standings[m.homeTeamId], a = standings[m.awayTeamId];
    if(!h||!a) return;
    h.played++; a.played++;
    h.goalsFor+=m.homeGoals; h.goalsAgainst+=m.awayGoals;
    a.goalsFor+=m.awayGoals; a.goalsAgainst+=m.homeGoals;
    if(m.homeGoals>m.awayGoals){h.won++;h.points+=3;a.lost++;}
    else if(m.homeGoals<m.awayGoals){a.won++;a.points+=3;h.lost++;}
    else{h.drawn++;a.drawn++;h.points++;a.points++;}
  });

  const table = Object.values(standings);
  table.forEach(r=>r.goalDifference=r.goalsFor-r.goalsAgainst);
  table.sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor);
  table.forEach((r,i)=>r.position=i+1);
  return table;
}

async function getSeason() {
  const db = getDb();
  const doc = await db.collection('meta').doc('season').get();
  return doc.exists ? doc.data() : null;
}

async function advanceMatchday() {
  const db = getDb();
  const season = await getSeason();
  
  if(season.currentMatchday >= season.totalMatchdays){
    // Season finished - run end of season logic
    await endOfSeason();
    await db.collection('meta').doc('season').update({status:'finished'});
    return false;
  }
  
  // Advance to next matchday
  await db.collection('meta').doc('season').update({
    currentMatchday: admin.firestore.FieldValue.increment(1)
  });
  
  // Weekly updates
  await weeklyUpdates();
  
  return true;
}

// ─── Weekly Updates ─────────────────────────────────────────────────────────
async function weeklyUpdates() {
  const db = getDb();
  
  // Update all players
  const playersSnap = await db.collection('players').get();
  const batch = db.batch();
  
  for(const doc of playersSnap.docs) {
    const player = doc.data();
    const updates = {};
    
    // Recover from injury
    if(player.injuryWeeks > 0) {
      updates.injuryWeeks = player.injuryWeeks - 1;
      if(updates.injuryWeeks <= 0) {
        updates.injuryType = null;
        updates.injuryWeeks = 0;
      }
    }
    
    // Recover from suspension (after one match)
    if(player.suspended) {
      updates.suspended = false;
    }
    
    // Recover fitness
    if(!player.injuryType) {
      updates.fitness = Math.min(100, (player.fitness || 80) + rand(5,15));
    }
    
    // Update form (random walk)
    const currentForm = player.form || 70;
    const formChange = rand(-5, 5);
    updates.form = clamp(currentForm + formChange, 30, 100);
    
    // Update morale based on recent performance
    const moraleChange = rand(-3, 3);
    updates.morale = clamp((player.morale || 70) + moraleChange, 20, 100);
    
    if(Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
    }
  }
  
  await batch.commit();
}

// ─── End of Season ──────────────────────────────────────────────────────────
async function endOfSeason() {
  const db = getDb();
  
  // Age all players
  const playersSnap = await db.collection('players').get();
  const batch = db.batch();
  
  for(const doc of playersSnap.docs) {
    const player = doc.data();
    const updates = {
      age: player.age + 1
    };
    
    // Young players grow
    if(player.age < 24 && player.ovr < player.potential) {
      const growth = rand(1, 3);
      const newOvr = Math.min(player.potential, player.ovr + growth);
      
      if(newOvr !== player.ovr) {
        updates.ovr = newOvr;
        // Update attributes proportionally
        const attrs = ['pace','shooting','passing','defending','physical','goalkeeping'];
        for(const attr of attrs) {
          if(player[attr] < 99) {
            updates[attr] = Math.min(99, player[attr] + rand(0, 2));
          }
        }
        // Recalculate value
        updates.value = calculateValue(newOvr, updates.age, player.position);
        updates.salary = calculateSalary(newOvr, updates.age);
      }
    }
    
    // Older players decline
    if(player.age >= 30) {
      const decline = player.age >= 33 ? rand(1, 3) : rand(0, 2);
      if(decline > 0 && player.ovr > 50) {
        updates.ovr = Math.max(50, player.ovr - decline);
        // Decline pace first, then physical
        if(player.pace > 50) updates.pace = Math.max(50, player.pace - rand(1, 3));
        if(player.physical > 50) updates.physical = Math.max(50, player.physical - rand(0, 2));
        // Recalculate value
        updates.value = calculateValue(updates.ovr, updates.age, player.position);
        updates.salary = calculateSalary(updates.ovr, updates.age);
      }
    }
    
    // Update contract
    if(player.contractYears !== undefined) {
      updates.contractYears = player.contractYears - 1;
      // Out of contract players become free
      if(updates.contractYears <= 0) {
        updates.clubId = 'free';
        updates.isListed = true;
        updates.askingPrice = 0;
      }
    }
    
    // Reset season stats
    updates.goals = 0;
    updates.assists = 0;
    updates.appearances = 0;
    updates.yellowCards = 0;
    updates.redCards = 0;
    
    batch.update(doc.ref, updates);
  }
  
  await batch.commit();
  
  // Start new season
  await startNewSeason();
}

// ─── Start New Season ───────────────────────────────────────────────────────
async function startNewSeason() {
  const db = getDb();
  
  // Get current season info
  const seasonDoc = await db.collection('meta').doc('season').get();
  const currentSeason = seasonDoc.data();
  
  // Get all clubs
  const clubsSnap = await db.collection('clubs').get();
  const clubIds = clubsSnap.docs.map(d => d.id);
  
  // Generate new fixtures
  const fixtures = generateFixtures(clubIds);
  
  // Delete old matches
  const oldMatches = await db.collection('matches').get();
  const deleteBatch = db.batch();
  oldMatches.docs.forEach(doc => deleteBatch.delete(doc.ref));
  await deleteBatch.commit();
  
  // Create new matches
  const batchSize = 400;
  for(let i = 0; i < fixtures.length; i += batchSize) {
    const batch = db.batch();
    fixtures.slice(i, i + batchSize).forEach(f => 
      batch.set(db.collection('matches').doc(), {
        ...f,
        homeGoals: 0,
        awayGoals: 0,
        simulated: false,
        events: []
      })
    );
    await batch.commit();
  }
  
  // Update season metadata
  await db.collection('meta').doc('season').update({
    seasonNumber: currentSeason.seasonNumber + 1,
    currentMatchday: 1,
    totalMatchdays: fixtures[fixtures.length - 1].matchday,
    status: 'active'
  });
  
  // Generate new transfer market players
  const market = generateTransferMarket(30);
  for(const p of market) await insertPlayer(p);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

async function getCurrentMatchdayFixtures() {
  const db = getDb();
  const season = await getSeason();
  const snap = await db.collection('matches').where('matchday','==',season.currentMatchday).get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function aiTransferActions() {
  const db = getDb();
  const aiSnap = await db.collection('clubs').where('isAi','==',true).get();
  for(const clubDoc of aiSnap.docs){
    const club = {id:clubDoc.id,...clubDoc.data()};
    const squadSnap = await db.collection('players').where('clubId','==',club.id).get();
    const squad = squadSnap.docs.map(d=>({id:d.id,...d.data()}));
    if(!squad.length) continue;

    if(Math.random()<0.3){
      const candidates = squad.filter(p=>p.age>29||p.ovr<60).sort((a,b)=>a.ovr-b.ovr);
      if(candidates.length>0){
        await db.collection('players').doc(candidates[0].id).update({isListed:true,askingPrice:Math.round(candidates[0].value*1.2)});
      }
    }

    if(club.transferBudget>1000000&&Math.random()<0.4){
      const marketSnap = await db.collection('players').where('clubId','==','free').where('isListed','==',true).get();
      const market = marketSnap.docs.map(d=>({id:d.id,...d.data()}));
      const avgOvr = squad.reduce((s,p)=>s+p.ovr,0)/squad.length;
      const target = market.filter(p=>p.ovr>avgOvr-3&&p.askingPrice<=club.transferBudget*0.5).sort((a,b)=>b.ovr-a.ovr)[0];
      if(target&&squad.length<28){
        const season = await getSeason();
        const batch = db.batch();
        batch.update(db.collection('players').doc(target.id),{clubId:club.id,isListed:false,askingPrice:0});
        batch.update(clubDoc.ref,{transferBudget:admin.firestore.FieldValue.increment(-target.askingPrice)});
        batch.set(db.collection('transfers').doc(),{playerId:target.id,fromClubId:'free',toClubId:club.id,fee:target.askingPrice,matchday:season.currentMatchday,createdAt:new Date().toISOString()});
        await batch.commit();
      }
    }
  }
}

async function initializeGame() {
  const db = getDb();
  const existing = await db.collection('clubs').limit(1).get();
  if(!existing.empty) return;

  const clubIds = [];
  for(const data of CLUB_DATA){
    const ref = await db.collection('clubs').add({
      name:data.name, shortName:data.shortName, stadium:data.stadium, city:data.city,
      balance:50000000+Math.round(data.strength*30000000),
      transferBudget:20000000+Math.round(data.strength*15000000),
      wageBudget:5000000+Math.round(data.strength*5000000),
      reputation:Math.round(data.strength*100),
      isAi:true, strengthTendency:data.strength, userId:null,
    });
    clubIds.push(ref.id);
  }

  for(let i=0;i<clubIds.length;i++){
    const squad = generateSquad(clubIds[i], Math.round(55+CLUB_DATA[i].strength*25));
    for(const p of squad) await insertPlayer(p);
  }

  const market = generateTransferMarket(50);
  for(const p of market) await insertPlayer(p);

  const fixtures = generateFixtures(clubIds);
  const totalMatchdays = fixtures[fixtures.length-1].matchday;
  const batchSize = 400;
  for(let i=0;i<fixtures.length;i+=batchSize){
    const batch = db.batch();
    fixtures.slice(i,i+batchSize).forEach(f=>batch.set(db.collection('matches').doc(),{...f,homeGoals:0,awayGoals:0,simulated:false,events:[]}));
    await batch.commit();
  }

  await db.collection('meta').doc('season').set({seasonNumber:1,currentMatchday:1,totalMatchdays,status:'active'});
}

async function createUserClub(userId, clubName, stadium, city) {
  const db = getDb();
  const snap = await db.collection('clubs').where('isAi','==',true).orderBy('strengthTendency','asc').limit(1).get();
  if(snap.empty) throw new Error('No available clubs');
  const weakest = snap.docs[0];

  await weakest.ref.update({
    name:clubName, shortName:clubName.substring(0,3).toUpperCase(),
    stadium, city, isAi:false, userId,
    balance:50000000, transferBudget:25000000, wageBudget:6000000, reputation:50,
  });

  const oldSquad = await db.collection('players').where('clubId','==',weakest.id).get();
  const batch = db.batch();
  oldSquad.docs.forEach(d=>batch.delete(d.ref));
  await batch.commit();

  const squad = generateSquad(weakest.id, 65);
  for(const p of squad) await insertPlayer(p);

  await db.collection('users').doc(userId).update({clubId:weakest.id});
  return weakest.id;
}

// ─── Auto-Simulation ───────────────────────────────────────────────────────
let autoSimTimer = null;
let autoAdvanceTimer = null;
let justAdvanced = false;
const AUTO_SIM_INTERVAL = 20000;   // 20s between auto-sim checks
const AUTO_ADVANCE_DELAY = 30000;  // 30s after all matches simulated before advancing

function startAutoSimulation() {
  if (autoSimTimer) return;
  console.log('[AutoSim] Starting auto-simulation loop');
  autoSimTimer = setInterval(autoSimTick, AUTO_SIM_INTERVAL);
  // Run first tick after a short delay to let initialization finish
  setTimeout(autoSimTick, 3000);
}

function stopAutoSimulation() {
  if (autoSimTimer) { clearInterval(autoSimTimer); autoSimTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  console.log('[AutoSim] Stopped auto-simulation loop');
}

async function autoSimTick() {
  try {
    // Skip one tick after advancing to give player time to manage
    if (justAdvanced) { justAdvanced = false; return; }

    const season = await getSeason();
    if (!season || season.status === 'finished') return;

    const db = getDb();
    const unsimSnap = await db.collection('matches')
      .where('matchday', '==', season.currentMatchday)
      .where('simulated', '==', false).get();

    if (!unsimSnap.empty) {
      console.log(`[AutoSim] Simulating matchday ${season.currentMatchday} (${unsimSnap.size} matches)`);
      const results = await simulateMatchday(season.currentMatchday);
      await aiTransferActions();
      console.log(`[AutoSim] Matchday ${season.currentMatchday} complete`);

      // Schedule auto-advance after a delay
      if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = setTimeout(autoAdvanceTick, AUTO_ADVANCE_DELAY);
    }
  } catch (err) {
    console.error('[AutoSim] Error in tick:', err.message);
  }
}

async function autoAdvanceTick() {
  try {
    const season = await getSeason();
    if (!season || season.status === 'finished') return;

    // Check if all matches for current matchday are simulated
    const db = getDb();
    const unsimSnap = await db.collection('matches')
      .where('matchday', '==', season.currentMatchday)
      .where('simulated', '==', false).get();

    if (!unsimSnap.empty) return; // Not ready yet

    // Deduct wages for all user clubs
    const userClubsSnap = await db.collection('clubs').where('isAi', '==', false).get();
    for (const clubDoc of userClubsSnap.docs) {
      const club = clubDoc.data();
      if (!club.userId) continue;
      const squadSnap = await db.collection('players').where('clubId', '==', clubDoc.id).get();
      const totalWages = squadSnap.docs.reduce((s, d) => s + (d.data().salary || 0), 0);
      if (totalWages > 0) {
        await db.collection('clubs').doc(clubDoc.id).update({
          balance: admin.firestore.FieldValue.increment(-totalWages)
        });
      }
    }

    const advanced = await advanceMatchday();
    if (advanced) {
      justAdvanced = true;
      const newSeason = await getSeason();
      console.log(`[AutoSim] Advanced to matchday ${newSeason.currentMatchday}`);
    } else {
      console.log('[AutoSim] Season finished!');
    }
  } catch (err) {
    console.error('[AutoSim] Error advancing:', err.message);
  }
}

module.exports = {
  initializeGame, createUserClub, generateFixtures, getStandings, getSeason,
  advanceMatchday, getCurrentMatchdayFixtures, simulateMatchday, aiTransferActions,
  startAutoSimulation, stopAutoSimulation, autoSimTick, autoAdvanceTick, CLUB_DATA
};
