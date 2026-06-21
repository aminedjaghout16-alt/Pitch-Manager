const { getDb } = require('./db');

const MENTALITY_MOD = {defensive:0.85,counter:0.92,balanced:1.0,attacking:1.08,'all-out':1.15};
const PRESSING_MOD = {low:0.9,normal:1.0,high:1.06,gegenpress:1.1};
const TEMPO_MOD = {slow:0.92,normal:1.0,fast:1.05,relentless:1.1};

async function getTeamStrength(clubId) {
  const db = getDb();
  const [clubDoc, squadSnap] = await Promise.all([
    db.collection('clubs').doc(clubId).get(),
    db.collection('players').where('clubId','==',clubId).get(),
  ]);
  const club = clubDoc.data();
  const players = squadSnap.docs.map(d => ({id:d.id,...d.data()}));
  if (players.length === 0) return {attack:50,defense:50,midfield:50,avgOvr:50};

  const tactics = club.tactics || null;
  const best11 = tactics && tactics.lineup && Object.keys(tactics.lineup).length >= 7
    ? selectFromLineup(players, tactics)
    : selectBest11(players);

  const avgOvr = best11.reduce((s,p) => s+p.ovr,0) / best11.length;
  const avgMorale = best11.reduce((s,p) => s+p.morale,0) / best11.length / 100;
  const avgFitness = best11.reduce((s,p) => s+p.fitness,0) / best11.length / 100;

  const attack = calcUnit(best11,['ST','LW','RW','CAM'],['shooting','pace']);
  const midfield = calcUnit(best11,['CM','CDM','CAM'],['passing','defending']);
  const defense = calcUnit(best11,['CB','LB','RB','GK'],['defending','physical']);

  let mf = 0.8 + avgMorale * 0.4;
  const ff = 0.9 + avgFitness * 0.2;

  if (tactics) {
    const mentMod = MENTALITY_MOD[tactics.mentality] || 1.0;
    const pressMod = PRESSING_MOD[tactics.pressing] || 1.0;
    const tempMod = TEMPO_MOD[tactics.tempo] || 1.0;
    const attackMod = mentMod * tempMod;
    const defenseMod = (2 - mentMod) * pressMod;
    const midMod = pressMod * tempMod;
    return {
      attack: attack * mf * ff * attackMod,
      midfield: midfield * mf * ff * midMod,
      defense: defense * mf * ff * defenseMod,
      avgOvr: avgOvr * mf * ff
    };
  }

  return {attack:attack*mf*ff, midfield:midfield*mf*ff, defense:defense*mf*ff, avgOvr:avgOvr*mf*ff};
}

function selectFromLineup(players, tactics) {
  const lineup = tactics.lineup;
  const selected = [];
  const used = new Set();
  for (const [slotIdx, playerId] of Object.entries(lineup)) {
    const p = players.find(pl => pl.id === playerId);
    if (p && !used.has(p.id)) { selected.push(p); used.add(p.id); }
  }
  if (selected.length < 11) {
    players.filter(p => !used.has(p.id)).sort((a,b) => b.ovr - a.ovr).forEach(p => {
      if (selected.length < 11) { selected.push(p); used.add(p.id); }
    });
  }
  return selected.slice(0, 11);
}

function calcUnit(players, positions, attrs) {
  const pp = players.filter(p => positions.includes(p.position));
  if (!pp.length) return 50;
  return pp.reduce((s,p) => s + attrs.reduce((a,k) => a+(p[k]||50),0)/attrs.length, 0) / pp.length;
}

function selectBest11(players) {
  const formation = {GK:1,CB:2,LB:1,RB:1,CDM:1,CM:2,LW:1,RW:1,ST:1};
  const selected = [], used = new Set();
  for (const [pos,count] of Object.entries(formation)) {
    players.filter(p => p.position===pos && !used.has(p.id)).sort((a,b)=>b.ovr-a.ovr).slice(0,count).forEach(p=>{selected.push(p);used.add(p.id);});
  }
  players.filter(p=>!used.has(p.id)).sort((a,b)=>b.ovr-a.ovr).forEach(p=>{if(selected.length<11){selected.push(p);used.add(p.id);}});
  return selected.slice(0,11);
}

function poisson(lambda) {
  let L=Math.exp(-lambda),k=0,p=1;
  do{k++;p*=Math.random();}while(p>L);
  return k-1;
}

function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min;}

function pickScorer(players) {
  const pool = players.filter(p=>['ST','LW','RW','CAM','CM'].includes(p.position));
  const p2 = pool.length>0?pool:players;
  const w = p2.map(p=>p.shooting||50), t=w.reduce((a,b)=>a+b,0);
  let r=Math.random()*t;
  for(let i=0;i<p2.length;i++){r-=w[i];if(r<=0)return p2[i];}
  return p2[p2.length-1];
}

function pickAssister(players,scorer) {
  const c=players.filter(p=>p.id!==scorer?.id&&['CM','CAM','LW','RW','ST','LB','RB'].includes(p.position));
  if(!c.length)return null;
  const w=c.map(p=>p.passing||50),t=w.reduce((a,b)=>a+b,0);
  let r=Math.random()*t;
  for(let i=0;i<c.length;i++){r-=w[i];if(r<=0)return c[i];}
  return c[c.length-1];
}

function pickRandom(players){return players[Math.floor(Math.random()*players.length)];}

async function simulateMatch(homeId, awayId) {
  const [hs, as] = await Promise.all([getTeamStrength(homeId), getTeamStrength(awayId)]);
  const homeGoals = poisson(Math.min(4.0,Math.max(0.3,(hs.attack*1.12)/Math.max(30,as.defense)*1.2)));
  const awayGoals = poisson(Math.min(3.5,Math.max(0.2,as.attack/Math.max(30,hs.defense)*1.0)));

  const db = getDb();
  const [hSnap, aSnap] = await Promise.all([
    db.collection('players').where('clubId','==',homeId).get(),
    db.collection('players').where('clubId','==',awayId).get(),
  ]);
  const hPlayers = hSnap.docs.map(d=>({id:d.id,...d.data()}));
  const aPlayers = aSnap.docs.map(d=>({id:d.id,...d.data()}));

  const events = [];
  for(let i=0;i<homeGoals;i++){const s=pickScorer(hPlayers),a=pickAssister(hPlayers,s);events.push({type:'goal',team:'home',minute:rand(1,90),player:s?`${s.firstName} ${s.lastName}`:'Unknown',playerId:s?.id,assist:a?`${a.firstName} ${a.lastName}`:null,assistId:a?.id});}
  for(let i=0;i<awayGoals;i++){const s=pickScorer(aPlayers),a=pickAssister(aPlayers,s);events.push({type:'goal',team:'away',minute:rand(1,90),player:s?`${s.firstName} ${s.lastName}`:'Unknown',playerId:s?.id,assist:a?`${a.firstName} ${a.lastName}`:null,assistId:a?.id});}
  for(let i=0;i<rand(0,3);i++){const p=pickRandom(hPlayers);events.push({type:'yellow',team:'home',minute:rand(1,90),player:`${p.firstName} ${p.lastName}`,playerId:p.id});}
  for(let i=0;i<rand(0,3);i++){const p=pickRandom(aPlayers);events.push({type:'yellow',team:'away',minute:rand(1,90),player:`${p.firstName} ${p.lastName}`,playerId:p.id});}
  if(Math.random()<0.1){const team=Math.random()<0.5?'home':'away';const p=pickRandom(team==='home'?hPlayers:aPlayers);events.push({type:'red',team,minute:rand(20,90),player:`${p.firstName} ${p.lastName}`,playerId:p.id});}
  events.sort((a,b)=>a.minute-b.minute);

  // Update player stats
  const stats = {};
  for(const e of events){
    if(e.playerId){if(!stats[e.playerId])stats[e.playerId]={goals:0,assists:0,yellows:0,reds:0};if(e.type==='goal')stats[e.playerId].goals++;else if(e.type==='yellow')stats[e.playerId].yellows++;else if(e.type==='red')stats[e.playerId].reds++;}
    if(e.type==='goal'&&e.assistId){if(!stats[e.assistId])stats[e.assistId]={goals:0,assists:0,yellows:0,reds:0};stats[e.assistId].assists++;}
  }
  const batch = db.batch();
  for(const [pid,s] of Object.entries(stats)){
    const ref=db.collection('players').doc(pid);
    batch.update(ref,{goals:require('firebase-admin').firestore.FieldValue.increment(s.goals),assists:require('firebase-admin').firestore.FieldValue.increment(s.assists),yellowCards:require('firebase-admin').firestore.FieldValue.increment(s.yellows),redCards:require('firebase-admin').firestore.FieldValue.increment(s.reds)});
  }
  for(const p of [...hPlayers,...aPlayers]){
    batch.update(db.collection('players').doc(p.id),{appearances:require('firebase-admin').firestore.FieldValue.increment(1),fitness:Math.max(50,p.fitness-rand(3,10))});
  }
  await batch.commit();

  return {homeGoals,awayGoals,events};
}

async function simulateMatchday(matchday) {
  const db = getDb();
  const snap = await db.collection('matches').where('matchday','==',matchday).where('simulated','==',false).get();
  const results = [];

  for(const doc of snap.docs){
    const match = {id:doc.id,...doc.data()};
    const result = await simulateMatch(match.homeTeamId, match.awayTeamId);
    const homePoss=rand(35,65),awayPoss=100-homePoss;
    const homeShots=rand(5,20),awayShots=rand(5,20);
    await doc.ref.update({
      homeGoals:result.homeGoals, awayGoals:result.awayGoals,
      simulated:true, events:result.events,
      homePossession:homePoss, awayPossession:awayPoss,
      homeShots, awayShots,
      homeShotsOnTarget:Math.min(homeShots,rand(2,result.homeGoals+3)),
      awayShotsOnTarget:Math.min(awayShots,rand(2,result.awayGoals+3)),
      homeCorners:rand(2,10), awayCorners:rand(2,10),
      homeFouls:rand(8,18), awayFouls:rand(8,18),
      playedAt:new Date().toISOString(),
    });
    results.push({matchId:match.id,homeTeamId:match.homeTeamId,awayTeamId:match.awayTeamId,...result});
  }
  return results;
}

module.exports = {simulateMatch,simulateMatchday,getTeamStrength,selectBest11};
