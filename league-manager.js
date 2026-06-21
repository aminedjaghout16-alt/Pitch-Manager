const { getDb } = require('./db');
const { generateSquad, insertPlayer, generateTransferMarket } = require('./player-generator');
const { simulateMatchday } = require('./match-simulator');
const admin = require('firebase-admin');

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
  const n = teamIds.length, fixtures = [], teams = [...teamIds], half = n/2;
  for(let r=0;r<n-1;r++){
    const md=r+1;
    for(let i=0;i<half;i++){
      const h=teams[i],a=teams[n-1-i];
      fixtures.push(r%2===0?{matchday:md,homeTeamId:h,awayTeamId:a}:{matchday:md,homeTeamId:a,awayTeamId:h});
    }
    teams.splice(1,0,teams.pop());
  }
  const off=n-1;
  for(const f of [...fixtures]) fixtures.push({matchday:f.matchday+off,homeTeamId:f.awayTeamId,awayTeamId:f.homeTeamId});
  return fixtures;
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
    await db.collection('meta').doc('season').update({status:'finished'});
    return false;
  }
  await db.collection('meta').doc('season').update({currentMatchday:admin.firestore.FieldValue.increment(1)});
  return true;
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

module.exports = {initializeGame,createUserClub,generateFixtures,getStandings,getSeason,advanceMatchday,getCurrentMatchdayFixtures,simulateMatchday,aiTransferActions,CLUB_DATA};
