const { query, queryAll, queryOne, transaction } = require('./db');

// ─── Constants ──────────────────────────────────────────────────────────────
const MENTALITY_MOD = {defensive:0.85,counter:0.92,balanced:1.0,attacking:1.08,'all-out':1.15};
const PRESSING_MOD = {low:0.9,normal:1.0,high:1.06,gegenpress:1.1};
const TEMPO_MOD = {slow:0.92,normal:1.0,fast:1.05,relentless:1.1};

const INJURY_TYPES = [
  {type:'Knock',weeks:[1,2],weight:40},
  {type:'Muscle Strain',weeks:[2,4],weight:25},
  {type:'Ankle Sprain',weeks:[2,5],weight:20},
  {type:'Hamstring',weeks:[3,6],weight:10},
  {type:'Knee Injury',weeks:[4,10],weight:5}
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}

function weightedPick(items){
  const total=items.reduce((s,i)=>s+i.weight,0);
  let r=Math.random()*total;
  for(const item of items){r-=item.weight;if(r<=0)return item;}
  return items[items.length-1];
}

function poisson(lambda){
  let L=Math.exp(-lambda),k=0,p=1;
  do{k++;p*=Math.random();}while(p>L);
  return k-1;
}

// ─── Team Strength Calculation ──────────────────────────────────────────────
async function getTeamStrength(clubId){
  const [club, players] = await Promise.all([
    queryOne('SELECT * FROM clubs WHERE id=$1', [clubId]),
    queryAll('SELECT * FROM players WHERE club_id=$1', [clubId])
  ]);
  
  if(!club || players.length===0) return {attack:50,defense:50,midfield:50,avgOvr:50,players:[],homeAdv:1.08};

  const tactics = club.tactics || null;
  const best11 = tactics && tactics.lineup && Object.keys(tactics.lineup).length>=7
    ? selectFromLineup(players, tactics)
    : selectBest11(players);

  const avgOvr = best11.reduce((s,p)=>s+p.ovr,0)/best11.length;
  const avgMorale = best11.reduce((s,p)=>s+(p.morale||70),0)/best11.length/100;
  const avgFitness = best11.reduce((s,p)=>s+(p.fitness||80),0)/best11.length/100;

  const attack = calcUnit(best11,['ST','LW','RW','CAM'],['shooting','pace']);
  const midfield = calcUnit(best11,['CM','CDM','CAM'],['passing','defending']);
  const defense = calcUnit(best11,['CB','LB','RB','GK'],['defending','physical']);

  const moraleMod = 0.8+avgMorale*0.4;
  const fitnessMod = 0.9+avgFitness*0.2;

  let attackMod=1.0, defenseMod=1.0, midMod=1.0;
  if(tactics){
    const mentMod = MENTALITY_MOD[tactics.mentality]||1.0;
    const pressMod = PRESSING_MOD[tactics.pressing]||1.0;
    const tempMod = TEMPO_MOD[tactics.tempo]||1.0;
    attackMod = mentMod*tempMod;
    defenseMod = (2-mentMod)*pressMod;
    midMod = pressMod*tempMod;
  }

  return {
    attack: attack*moraleMod*fitnessMod*attackMod,
    midfield: midfield*moraleMod*fitnessMod*midMod,
    defense: defense*moraleMod*fitnessMod*defenseMod,
    avgOvr: avgOvr*moraleMod*fitnessMod,
    players: best11,
    homeAdv: 1.08
  };
}

function calcUnit(players, positions, attrs){
  const pp = players.filter(p => positions.includes(p.position));
  if(!pp.length) return 50;
  return pp.reduce((s,p) => s + attrs.reduce((a,k) => a+(p[k]||50),0)/attrs.length, 0)/pp.length;
}

// ─── Lineup Selection ───────────────────────────────────────────────────────
function selectFromLineup(players, tactics){
  const lineup = tactics.lineup;
  const selected = [];
  const used = new Set();
  
  for(const [slotIdx, playerId] of Object.entries(lineup)){
    const p = players.find(pl => String(pl.id) === String(playerId));
    if(p && !used.has(p.id)){
      if(!p.injury_type && !p.suspended){
        selected.push(p);
        used.add(p.id);
      }
    }
  }
  
  if(selected.length < 11){
    players.filter(p => !used.has(p.id) && !p.injury_type && !p.suspended)
      .sort((a,b) => b.ovr - a.ovr)
      .forEach(p => {
        if(selected.length < 11){ selected.push(p); used.add(p.id); }
      });
  }
  
  return selected.slice(0,11);
}

function selectBest11(players){
  const formation = {GK:1,CB:2,LB:1,RB:1,CDM:1,CM:2,LW:1,RW:1,ST:1};
  const selected = [], used = new Set();
  
  for(const [pos, count] of Object.entries(formation)){
    players.filter(p => p.position===pos && !used.has(p.id) && !p.injury_type && !p.suspended)
      .sort((a,b) => b.ovr - a.ovr)
      .slice(0, count)
      .forEach(p => { selected.push(p); used.add(p.id); });
  }
  
  players.filter(p => !used.has(p.id) && !p.injury_type && !p.suspended)
    .sort((a,b) => b.ovr - a.ovr)
    .forEach(p => { if(selected.length < 11){ selected.push(p); used.add(p.id); }});
  
  return selected.slice(0,11);
}

// ─── Match Simulation ───────────────────────────────────────────────────────
async function simulateMatch(homeId, awayId){
  const [homeStrength, awayStrength] = await Promise.all([
    getTeamStrength(homeId),
    getTeamStrength(awayId)
  ]);

  const homePlayers = homeStrength.players;
  const awayPlayers = awayStrength.players;

  if(homePlayers.length===0 || awayPlayers.length===0){
    return {homeGoals:0, awayGoals:0, events:[], homePlayers, awayPlayers, stats:{}};
  }

  const homeAttack = homeStrength.attack * homeStrength.homeAdv;
  const awayAttack = awayStrength.attack;
  const homeDefense = homeStrength.defense * homeStrength.homeAdv;
  const awayDefense = awayStrength.defense;

  const homeLambda = clamp((homeAttack*1.1)/(awayDefense*0.9)*1.3, 0.3, 4.0);
  const awayLambda = clamp((awayAttack*1.0)/(homeDefense*1.0)*1.0, 0.2, 3.5);

  const homeGoals = poisson(homeLambda);
  const awayGoals = poisson(awayLambda);

  const events = [];
  
  for(let i=0; i<homeGoals; i++){
    const minute = rand(1,90);
    const scorer = pickScorer(homePlayers);
    const assister = pickAssister(homePlayers, scorer);
    events.push({
      type:'goal', team:'home', minute,
      player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown',
      playerId: scorer?.id,
      assist: assister ? `${assister.first_name} ${assister.last_name}` : null,
      assistId: assister?.id
    });
  }
  
  for(let i=0; i<awayGoals; i++){
    const minute = rand(1,90);
    const scorer = pickScorer(awayPlayers);
    const assister = pickAssister(awayPlayers, scorer);
    events.push({
      type:'goal', team:'away', minute,
      player: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown',
      playerId: scorer?.id,
      assist: assister ? `${assister.first_name} ${assister.last_name}` : null,
      assistId: assister?.id
    });
  }

  const homeYellows = rand(0,3);
  const awayYellows = rand(0,3);
  
  for(let i=0; i<homeYellows; i++){
    const p = pickRandom(homePlayers);
    if(p) events.push({
      type:'yellow', team:'home', minute:rand(1,90),
      player:`${p.first_name} ${p.last_name}`, playerId:p.id
    });
  }
  
  for(let i=0; i<awayYellows; i++){
    const p = pickRandom(awayPlayers);
    if(p) events.push({
      type:'yellow', team:'away', minute:rand(1,90),
      player:`${p.first_name} ${p.last_name}`, playerId:p.id
    });
  }

  if(Math.random() < 0.08){
    const team = Math.random() < 0.5 ? 'home' : 'away';
    const players = team==='home' ? homePlayers : awayPlayers;
    const p = pickRandom(players);
    if(p) events.push({
      type:'red', team, minute:rand(20,90),
      player:`${p.first_name} ${p.last_name}`, playerId:p.id
    });
  }

  // Injuries during match
  const allPlayers = [...homePlayers, ...awayPlayers];
  for(const p of allPlayers){
    if(Math.random() < 0.03){
      const injury = weightedPick(INJURY_TYPES);
      const weeks = rand(injury.weeks[0], injury.weeks[1]);
      events.push({
        type:'injury', team: p.team||'home', minute:rand(1,90),
        player:`${p.first_name} ${p.last_name}`, playerId:p.id,
        injuryType: injury.type, injuryWeeks: weeks
      });
    }
  }

  events.sort((a,b) => a.minute - b.minute);

  const homePoss = rand(35,65);
  const awayPoss = 100 - homePoss;
  const homeShots = rand(5,20);
  const awayShots = rand(5,20);

  return {
    homeGoals, awayGoals, events,
    homePlayers, awayPlayers,
    stats: {
      homePossession: homePoss,
      awayPossession: awayPoss,
      homeShots, awayShots,
      homeShotsOnTarget: Math.min(homeShots, rand(2, homeGoals+3)),
      awayShotsOnTarget: Math.min(awayShots, rand(2, awayGoals+3)),
      homeCorners: rand(2,10), awayCorners: rand(2,10),
      homeFouls: rand(8,18), awayFouls: rand(8,18)
    }
  };
}

function pickScorer(players){
  const pool = players.filter(p => ['ST','LW','RW','CAM','CM'].includes(p.position));
  const candidates = pool.length > 0 ? pool : players;
  
  const weights = candidates.map(p => {
    const shooting = p.shooting || 50;
    const form = (p.form || 70) / 100;
    const morale = (p.morale || 70) / 100;
    return shooting * form * morale;
  });
  
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total;
  for(let i=0; i<candidates.length; i++){
    r -= weights[i];
    if(r <= 0) return candidates[i];
  }
  return candidates[candidates.length-1];
}

function pickAssister(players, scorer){
  const candidates = players.filter(p =>
    p.id !== scorer?.id &&
    ['CM','CAM','LW','RW','ST','LB','RB'].includes(p.position)
  );
  if(!candidates.length) return null;
  
  const weights = candidates.map(p => {
    const passing = p.passing || 50;
    const form = (p.form || 70) / 100;
    return passing * form;
  });
  
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total;
  for(let i=0; i<candidates.length; i++){
    r -= weights[i];
    if(r <= 0) return candidates[i];
  }
  return candidates[candidates.length-1];
}

function pickRandom(players){
  return players.length > 0 ? players[Math.floor(Math.random()*players.length)] : null;
}

// ─── Matchday Simulation ────────────────────────────────────────────────────
async function simulateMatchday(matchday){
  const unsimMatches = await queryAll(`
    SELECT * FROM matches WHERE matchday=$1 AND simulated=FALSE
  `, [matchday]);
  
  const results = [];

  for(const match of unsimMatches){
    const result = await simulateMatch(match.home_team_id, match.away_team_id);
    
    // Update match document
    await query(`
      UPDATE matches SET
        home_goals=$1, away_goals=$2, simulated=TRUE,
        events=$3,
        home_possession=$4, away_possession=$5,
        home_shots=$6, away_shots=$7,
        home_shots_on_target=$8, away_shots_on_target=$9,
        home_corners=$10, away_corners=$11,
        home_fouls=$12, away_fouls=$13,
        played_at=NOW()
      WHERE id=$14
    `, [
      result.homeGoals, result.awayGoals,
      JSON.stringify(result.events),
      result.stats.homePossession, result.stats.awayPossession,
      result.stats.homeShots, result.stats.awayShots,
      result.stats.homeShotsOnTarget, result.stats.awayShotsOnTarget,
      result.stats.homeCorners, result.stats.awayCorners,
      result.stats.homeFouls, result.stats.awayFouls,
      match.id
    ]);

    // Update player stats
    await updatePlayerStats(result);

    results.push({
      matchId: match.id,
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      ...result
    });
  }

  return results;
}

// ─── Player Stats Update ────────────────────────────────────────────────────
async function updatePlayerStats(result){
  const stats = {};

  for(const e of result.events){
    if(!e.playerId) continue;
    
    if(!stats[e.playerId]){
      stats[e.playerId] = {goals:0, assists:0, yellows:0, reds:0, injury:null};
    }
    
    if(e.type==='goal') stats[e.playerId].goals++;
    else if(e.type==='yellow') stats[e.playerId].yellows++;
    else if(e.type==='red') stats[e.playerId].reds++;
    
    if(e.type==='goal' && e.assistId){
      if(!stats[e.assistId]) stats[e.assistId] = {goals:0, assists:0, yellows:0, reds:0, injury:null};
      stats[e.assistId].assists++;
    }
    
    if(e.type==='injury'){
      stats[e.playerId].injury = {type: e.injuryType, weeks: e.injuryWeeks};
    }
  }

  // Update player documents
  for(const [playerId, s] of Object.entries(stats)){
    if(s.injury){
      await query(`
        UPDATE players SET
          appearances = appearances + 1,
          career_appearances = career_appearances + 1,
          goals = goals + $1,
          career_goals = career_goals + $2,
          assists = assists + $3,
          career_assists = career_assists + $4,
          yellow_cards = yellow_cards + $5,
          career_yellow_cards = career_yellow_cards + $6,
          red_cards = red_cards + $7,
          career_red_cards = career_red_cards + $8,
          injury_type = $9,
          injury_weeks = $10,
          suspended = CASE WHEN $11 > 0 THEN TRUE ELSE suspended END
        WHERE id = $12
      `, [
        s.goals, s.goals,
        s.assists, s.assists,
        s.yellows, s.yellows,
        s.reds, s.reds,
        s.injury.type, s.injury.weeks,
        s.reds,
        playerId
      ]);
    } else {
      await query(`
        UPDATE players SET
          appearances = appearances + 1,
          career_appearances = career_appearances + 1,
          goals = goals + $1,
          career_goals = career_goals + $2,
          assists = assists + $3,
          career_assists = career_assists + $4,
          yellow_cards = yellow_cards + $5,
          career_yellow_cards = career_yellow_cards + $6,
          red_cards = red_cards + $7,
          career_red_cards = career_red_cards + $8,
          suspended = CASE WHEN $9 > 0 THEN TRUE ELSE suspended END
        WHERE id = $10
      `, [
        s.goals, s.goals,
        s.assists, s.assists,
        s.yellows, s.yellows,
        s.reds, s.reds,
        s.reds,
        playerId
      ]);
    }
  }

  // Update fitness for all players who played
  const allPlayerIds = new Set([
    ...result.homePlayers.map(p => p.id),
    ...result.awayPlayers.map(p => p.id)
  ]);

  for(const playerId of allPlayerIds){
    if(stats[playerId]) continue;
    
    const player = result.homePlayers.find(p => p.id === playerId) || 
                   result.awayPlayers.find(p => p.id === playerId);
    const fitDrop = rand(3, 8);
    const newFitness = Math.max(50, (player?.fitness || 80) - fitDrop);
    
    await query(`
      UPDATE players SET
        appearances = appearances + 1,
        career_appearances = career_appearances + 1,
        fitness = $1
      WHERE id = $2
    `, [newFitness, playerId]);
  }
}

module.exports = {
  simulateMatch,
  simulateMatchday,
  getTeamStrength,
  selectBest11,
  selectFromLineup
};
