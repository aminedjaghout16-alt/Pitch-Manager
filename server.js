const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const admin = require('firebase-admin');
const { getDb } = require('./db');
const { generatePlayer, insertPlayer, generateTransferMarket, calculateOVR } = require('./player-generator');
const { simulateMatchday, getTeamStrength } = require('./match-simulator');
const { initializeGame, createUserClub, getStandings, getSeason, advanceMatchday, getCurrentMatchdayFixtures, aiTransferActions } = require('./league-manager');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'pitch-manager-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function formatMoney(n) {
  if(n==null)return '$0';
  const abs=Math.abs(n);
  if(abs>=1000000)return(n<0?'-':'')+'$'+(abs/1000000).toFixed(1)+'M';
  if(abs>=1000)return(n<0?'-':'')+'$'+(abs/1000).toFixed(0)+'K';
  return '$'+n.toLocaleString();
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ','');
  if(!token) return res.status(401).json({error:'Authentication required'});
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const doc = await db.collection('users').doc(decoded.id).get();
    if(!doc.exists) return res.status(401).json({error:'User not found'});
    req.user = {id:doc.id,...doc.data()};
    next();
  } catch { return res.status(401).json({error:'Invalid token'}); }
}

function requireClub(req,res,next){
  if(!req.user.clubId) return res.status(400).json({error:'You must create a club first'});
  next();
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async(req,res)=>{
  try {
    const {username,email,password}=req.body;
    if(!username||!email||!password) return res.status(400).json({error:'All fields required'});
    if(password.length<6) return res.status(400).json({error:'Password must be at least 6 characters'});
    const db=getDb();
    const existing=await db.collection('users').where('username','==',username).get();
    const existingEmail=await db.collection('users').where('email','==',email).get();
    if(!existing.empty||!existingEmail.empty) return res.status(400).json({error:'Username or email already exists'});
    const hash=bcrypt.hashSync(password,10);
    const ref=await db.collection('users').add({username,email,passwordHash:hash,clubId:null,createdAt:new Date().toISOString()});
    const token=jwt.sign({id:ref.id},JWT_SECRET,{expiresIn:'30d'});
    res.json({token,user:{id:ref.id,username,email,clubId:null}});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/auth/login', async(req,res)=>{
  try {
    const {username,password}=req.body;
    const db=getDb();
    const snap=await db.collection('users').where('username','==',username).get();
    const snap2=snap.empty?await db.collection('users').where('email','==',username).get():snap;
    if(snap2.empty) return res.status(401).json({error:'Invalid credentials'});
    const doc=snap2.docs[0];
    const user={id:doc.id,...doc.data()};
    if(!bcrypt.compareSync(password,user.passwordHash)) return res.status(401).json({error:'Invalid credentials'});
    const token=jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'30d'});
    res.json({token,user:{id:user.id,username:user.username,email:user.email,clubId:user.clubId}});
  } catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/auth/me', auth, (req,res)=>{
  res.json({user:{id:req.user.id,username:req.user.username,email:req.user.email,clubId:req.user.clubId}});
});

// ─── Club Routes ──────────────────────────────────────────────────────────────
app.post('/api/club/create', auth, async(req,res)=>{
  if(req.user.clubId) return res.status(400).json({error:'You already have a club'});
  const {name,stadium,city}=req.body;
  if(!name||!stadium||!city) return res.status(400).json({error:'All fields required'});
  try {
    const clubId=await createUserClub(req.user.id,name,stadium,city);
    const db=getDb();
    const doc=await db.collection('clubs').doc(clubId).get();
    res.json({club:{id:doc.id,...doc.data()}});
  } catch(err){res.status(400).json({error:err.message});}
});

app.get('/api/club', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const doc=await db.collection('clubs').doc(req.user.clubId).get();
    const squad=await db.collection('players').where('clubId','==',req.user.clubId).get();
    const totalWages=squad.docs.reduce((s,d)=>s+d.data().salary,0);
    res.json({club:{id:doc.id,...doc.data()},squadSize:squad.size,totalWages});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const [clubDoc,season,standings]=await Promise.all([
      db.collection('clubs').doc(req.user.clubId).get(),
      getSeason(),getStandings(),
    ]);
    const club={id:clubDoc.id,...clubDoc.data()};
    const standing=standings.find(s=>s.clubId===req.user.clubId);

    const nextSnap=await db.collection('matches').where('matchday','==',season.currentMatchday).where('simulated','==',false).get();
    const nextMatch=nextSnap.docs.map(d=>({id:d.id,...d.data()})).find(m=>m.homeTeamId===req.user.clubId||m.awayTeamId===req.user.clubId)||null;

    const lastSnap=await db.collection('matches').where('simulated','==',true).orderBy('playedAt','desc').limit(20).get();
    const lastMatch=lastSnap.docs.map(d=>({id:d.id,...d.data()})).find(m=>m.homeTeamId===req.user.clubId||m.awayTeamId===req.user.clubId)||null;

    const squadSnap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    const totalWages=squadSnap.docs.reduce((s,d)=>s+d.data().salary,0);

    res.json({club,season,standing,nextMatch,lastMatch,totalWages});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Squad Routes ─────────────────────────────────────────────────────────────
app.get('/api/squad', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    let players=snap.docs.map(d=>({id:d.id,...d.data()}));
    const {sort='ovr',order='desc',position}=req.query;
    if(position) players=players.filter(p=>p.position===position);
    players.sort((a,b)=>order==='asc'?a[sort]-b[sort]:b[sort]-a[sort]);
    res.json({players});
  } catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/squad/:id', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const doc=await db.collection('players').doc(req.params.id).get();
    if(!doc.exists||doc.data().clubId!==req.user.clubId) return res.status(404).json({error:'Player not found'});
    res.json({player:{id:doc.id,...doc.data()}});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Transfer Market ──────────────────────────────────────────────────────────
app.get('/api/transfers/market', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('players').where('clubId','==','free').where('isListed','==',true).get();
    let players=snap.docs.map(d=>({id:d.id,...d.data()}));
    const {sort='ovr',order='desc',position,maxPrice}=req.query;
    if(position) players=players.filter(p=>p.position===position);
    if(maxPrice) players=players.filter(p=>p.askingPrice<=parseInt(maxPrice));
    players.sort((a,b)=>order==='asc'?a[sort]-b[sort]:b[sort]-a[sort]);
    const clubDoc=await db.collection('clubs').doc(req.user.clubId).get();
    res.json({players,budget:clubDoc.data().transferBudget});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/transfers/buy/:playerId', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const playerDoc=await db.collection('players').doc(req.params.playerId).get();
    if(!playerDoc.exists||playerDoc.data().clubId!=='free'||!playerDoc.data().isListed) return res.status(404).json({error:'Player not available'});
    const player={id:playerDoc.id,...playerDoc.data()};
    const clubDoc=await db.collection('clubs').doc(req.user.clubId).get();
    const club=clubDoc.data();
    if(club.transferBudget<player.askingPrice) return res.status(400).json({error:'Insufficient transfer budget'});
    const squadSnap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    if(squadSnap.size>=30) return res.status(400).json({error:'Squad is full (max 30)'});
    const season=await getSeason();
    const batch=db.batch();
    batch.update(playerDoc.ref,{clubId:req.user.clubId,isListed:false,askingPrice:0});
    batch.update(clubDoc.ref,{transferBudget:admin.firestore.FieldValue.increment(-player.askingPrice),balance:admin.firestore.FieldValue.increment(-player.askingPrice)});
    batch.set(db.collection('transfers').doc(),{playerId:player.id,fromClubId:'free',toClubId:req.user.clubId,fee:player.askingPrice,matchday:season.currentMatchday,createdAt:new Date().toISOString()});
    await batch.commit();
    await createNotification(req.user.id,'transfer_in','Player Signed',`${player.firstName} ${player.lastName} joined for ${formatMoney(player.askingPrice)}`);
    res.json({message:`Signed ${player.firstName} ${player.lastName}`,player});
  } catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/transfers/listed', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('players').where('clubId','==',req.user.clubId).where('isListed','==',true).get();
    res.json({players:snap.docs.map(d=>({id:d.id,...d.data()}))});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/transfers/sell/:playerId', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const playerDoc=await db.collection('players').doc(req.params.playerId).get();
    if(!playerDoc.exists||playerDoc.data().clubId!==req.user.clubId) return res.status(404).json({error:'Player not in your squad'});
    const player={id:playerDoc.id,...playerDoc.data()};
    const squadSnap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    if(squadSnap.size<=16) return res.status(400).json({error:'Cannot sell: minimum squad size is 16'});
    const season=await getSeason();
    const sellPrice=Math.round(player.value*0.9);
    const listPrice=player.askingPrice||Math.round(player.value*1.1);
    const batch=db.batch();
    batch.update(playerDoc.ref,{clubId:'free',isListed:true,askingPrice:listPrice});
    batch.update(db.collection('clubs').doc(req.user.clubId),{transferBudget:admin.firestore.FieldValue.increment(sellPrice),balance:admin.firestore.FieldValue.increment(sellPrice)});
    batch.set(db.collection('transfers').doc(),{playerId:player.id,fromClubId:req.user.clubId,toClubId:'free',fee:sellPrice,matchday:season.currentMatchday,createdAt:new Date().toISOString()});
    await batch.commit();
    res.json({message:`${player.firstName} ${player.lastName} listed. Received ${formatMoney(sellPrice)}.`});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Training ─────────────────────────────────────────────────────────────────
app.get('/api/training', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    res.json({players:snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.ovr-a.ovr)});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/training/:playerId', auth, requireClub, async(req,res)=>{
  try {
    const {focus}=req.body;
    const db=getDb();
    const playerDoc=await db.collection('players').doc(req.params.playerId).get();
    if(!playerDoc.exists||playerDoc.data().clubId!==req.user.clubId) return res.status(404).json({error:'Player not found'});
    const player={id:playerDoc.id,...playerDoc.data()};
    if(player.fitness<30) return res.status(400).json({error:'Fitness too low'});
    const clubDoc=await db.collection('clubs').doc(req.user.clubId).get();
    if(clubDoc.data().balance<10000) return res.status(400).json({error:'Insufficient funds'});
    const ageFactor=player.age<23?1.5:player.age<28?1.0:player.age<32?0.6:0.3;
    const gap=player.potential-player.ovr;
    let improvement=gap>0?Math.min(Math.ceil(Math.random()*2*ageFactor),Math.ceil(gap/5)):Math.random()<0.2?1:0;
    const updates={};
    const attrs=focus==='general'?['pace','shooting','passing','defending','physical']:[focus];
    for(const attr of attrs){
      if(attr==='general') continue;
      const gain=attr===focus?improvement:(improvement>0&&Math.random()<0.3?1:0);
      if(gain>0&&player[attr]<99) updates[attr]=Math.min(99,player[attr]+gain);
    }
    const updated={...player,...updates};
    const newOvr=calculateOVR(player.position,updated);
    const fitDrop=Math.floor(Math.random()*8)+5;
    await playerDoc.ref.update({...updates,ovr:newOvr,fitness:Math.max(40,player.fitness-fitDrop)});
    await clubDoc.ref.update({balance:admin.firestore.FieldValue.increment(-10000)});
    const fresh=await playerDoc.ref.get();
    res.json({message:`Training complete for ${player.firstName} ${player.lastName}`,player:{id:fresh.id,...fresh.data()},improvements:updates});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Tactics ─────────────────────────────────────────────────────────────────
app.get('/api/tactics', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const doc=await db.collection('clubs').doc(req.user.clubId).get();
    const club=doc.data();
    const tactics=club.tactics||{formation:'4-4-2',mentality:'balanced',pressing:'normal',tempo:'normal',passingStyle:'mixed',captainId:null,lineup:{}};
    const squadSnap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    const players=squadSnap.docs.map(d=>({id:d.id,...d.data()}));
    res.json({tactics,players});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/tactics', auth, requireClub, async(req,res)=>{
  try {
    const {formation,mentality,pressing,tempo,passingStyle,captainId,lineup}=req.body;
    const db=getDb();
    await db.collection('clubs').doc(req.user.clubId).update({
      tactics:{formation:formation||'4-4-2',mentality:mentality||'balanced',pressing:pressing||'normal',tempo:tempo||'normal',passingStyle:passingStyle||'mixed',captainId:captainId||null,lineup:lineup||{}}
    });
    res.json({success:true,message:'Tactics saved'});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Match Routes ─────────────────────────────────────────────────────────────
app.get('/api/clubs/:id/tactics', auth, async(req,res)=>{
  try {
    const db=getDb();
    const doc=await db.collection('clubs').doc(req.params.id).get();
    if(!doc.exists) return res.status(404).json({error:'Club not found'});
    const club=doc.data();
    const tactics=club.tactics||{formation:'4-4-2'};
    const squadSnap=await db.collection('players').where('clubId','==',req.params.id).get();
    const players=squadSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.ovr-a.ovr);
    res.json({tactics,players});
  } catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/matches/current', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const season=await getSeason();
    const snap=await db.collection('matches').where('matchday','==',season.currentMatchday).get();
    const matches=await Promise.all(snap.docs.map(async d=>{
      const m={id:d.id,...d.data()};
      const [h,a]=await Promise.all([db.collection('clubs').doc(m.homeTeamId).get(),db.collection('clubs').doc(m.awayTeamId).get()]);
      return{...m,homeName:h.data()?.name,homeShort:h.data()?.shortName,awayName:a.data()?.name,awayShort:a.data()?.shortName};
    }));
    const userMatch=matches.find(m=>m.homeTeamId===req.user.clubId||m.awayTeamId===req.user.clubId);
    res.json({matchday:season.currentMatchday,matches,userMatch,status:season.status});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/matches/simulate', auth, requireClub, async(req,res)=>{
  try {
    const season=await getSeason();
    if(season.status==='finished') return res.status(400).json({error:'Season is finished'});
    const db=getDb();
    const unsim=await db.collection('matches').where('matchday','==',season.currentMatchday).where('simulated','==',false).get();
    if(unsim.empty) return res.status(400).json({error:'Already simulated. Advance matchday.'});
    const results=await simulateMatchday(season.currentMatchday);
    await aiTransferActions();
    const standings=await getStandings();
    const userResult=results.find(r=>r.homeTeamId===req.user.clubId||r.awayTeamId===req.user.clubId);
    if(userResult){
      const isHome=userResult.homeTeamId===req.user.clubId;
      const ug=isHome?userResult.homeGoals:userResult.awayGoals;
      const og=isHome?userResult.awayGoals:userResult.homeGoals;
      const oppDoc=await db.collection('clubs').doc(isHome?userResult.awayTeamId:userResult.homeTeamId).get();
      const oppName=oppDoc.data()?.name;
      if(ug>og) await createNotification(req.user.id,'match_win','Victory!',`You defeated ${oppName} ${ug}-${og}`);
      else if(ug<og) await createNotification(req.user.id,'match_loss','Defeat',`You lost to ${oppName} ${ug}-${og}`);
      else await createNotification(req.user.id,'match_draw','Draw',`You drew with ${oppName} ${ug}-${og}`);
    }
    const enriched=await Promise.all(results.map(async r=>{
      const [h,a]=await Promise.all([db.collection('clubs').doc(r.homeTeamId).get(),db.collection('clubs').doc(r.awayTeamId).get()]);
      return{...r,homeName:h.data()?.name,homeShort:h.data()?.shortName,awayName:a.data()?.name,awayShort:a.data()?.shortName};
    }));
    res.json({matchday:season.currentMatchday,results:enriched,userResult,standings,canAdvance:true});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/matches/advance', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const success=await advanceMatchday();
    if(!success) return res.json({message:'Season finished!',finished:true,standings:await getStandings()});
    const squadSnap=await db.collection('players').where('clubId','==',req.user.clubId).get();
    const totalWages=squadSnap.docs.reduce((s,d)=>s+d.data().salary,0);
    await db.collection('clubs').doc(req.user.clubId).update({balance:admin.firestore.FieldValue.increment(-totalWages)});
    const batch=db.batch();
    squadSnap.docs.forEach(d=>batch.update(d.ref,{fitness:Math.min(100,d.data().fitness+Math.floor(Math.random()*10)+10)}));
    await batch.commit();
    const season=await getSeason();
    res.json({message:`Advanced to matchday ${season.currentMatchday}`,matchday:season.currentMatchday,season});
  } catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/matches/history', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('matches').where('simulated','==',true).orderBy('playedAt','desc').get();
    const matches=(await Promise.all(snap.docs.map(async d=>{
      const m={id:d.id,...d.data()};
      if(m.homeTeamId!==req.user.clubId&&m.awayTeamId!==req.user.clubId) return null;
      const [h,a]=await Promise.all([db.collection('clubs').doc(m.homeTeamId).get(),db.collection('clubs').doc(m.awayTeamId).get()]);
      return{...m,homeName:h.data()?.name,homeShort:h.data()?.shortName,awayName:a.data()?.name,awayShort:a.data()?.shortName};
    }))).filter(Boolean);
    res.json({matches});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Match Report ─────────────────────────────────────────────────────────────
app.get('/api/matches/report/:id', auth, async(req,res)=>{
  try {
    const db=getDb();
    const doc=await db.collection('matches').doc(req.params.id).get();
    if(!doc.exists) return res.status(404).json({error:'Match not found'});
    const m={id:doc.id,...doc.data()};
    const [h,a]=await Promise.all([
      db.collection('clubs').doc(m.homeTeamId).get(),
      db.collection('clubs').doc(m.awayTeamId).get(),
    ]);
    const match={
      ...m,
      homeName:h.data()?.name||'Home',
      homeShort:h.data()?.shortName||'HOM',
      awayName:a.data()?.name||'Away',
      awayShort:a.data()?.shortName||'AWY',
    };
    const events=Array.isArray(m.events)?m.events:[];
    const stats={
      home:{
        possession:m.homePossession||50,
        shots:m.homeShots||0,
        shotsOnTarget:m.homeShotsOnTarget||0,
        corners:m.homeCorners||0,
        fouls:m.homeFouls||0,
      },
      away:{
        possession:m.awayPossession||50,
        shots:m.awayShots||0,
        shotsOnTarget:m.awayShotsOnTarget||0,
        corners:m.awayCorners||0,
        fouls:m.awayFouls||0,
      },
    };
    // Generate player ratings from events
    const [hSnap,aSnap]=await Promise.all([
      db.collection('players').where('clubId','==',m.homeTeamId).get(),
      db.collection('players').where('clubId','==',m.awayTeamId).get(),
    ]);
    const hPlayers=hSnap.docs.map(d=>({id:d.id,...d.data()}));
    const aPlayers=aSnap.docs.map(d=>({id:d.id,...d.data()}));
    const goalScores={};
    const assistCounts={};
    const yellowCards={};
    const redCards={};
    for(const e of events){
      if(e.playerId){
        if(e.type==='goal'){goalScores[e.playerId]=(goalScores[e.playerId]||0)+1;}
        if(e.assistId){assistCounts[e.assistId]=(assistCounts[e.assistId]||0)+1;}
        if(e.type==='yellow'){yellowCards[e.playerId]=(yellowCards[e.playerId]||0)+1;}
        if(e.type==='red'){redCards[e.playerId]=(redCards[e.playerId]||0)+1;}
      }
    }
    const allPlayers=[...hPlayers.map(p=>({...p,team:'home'})),...aPlayers.map(p=>({...p,team:'away'}))];
    const playerRatings=allPlayers.map(p=>{
      const goals=goalScores[p.id]||0;
      const assists=assistCounts[p.id]||0;
      const yellows=yellowCards[p.id]||0;
      const reds=redCards[p.id]||0;
      let rating=6.5;
      rating+=goals*0.8;
      rating+=assists*0.4;
      rating-=yellows*0.3;
      rating-=reds*1.5;
      rating+=(p.ovr-65)*0.02;
      rating+=Math.random()*0.6-0.3;
      rating=Math.max(4.0,Math.min(10.0,Math.round(rating*10)/10));
      return {name:`${p.firstName} ${p.lastName}`,team:p.team,goals,assists,rating};
    });
    playerRatings.sort((a,b)=>b.rating-a.rating);
    res.json({match,events,stats,playerRatings});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── League ───────────────────────────────────────────────────────────────────
app.get('/api/league', auth, async(req,res)=>{
  try {
    const [standings,season]=await Promise.all([getStandings(),getSeason()]);
    res.json({standings,season});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Finances ─────────────────────────────────────────────────────────────────
app.get('/api/finances', auth, requireClub, async(req,res)=>{
  try {
    const db=getDb();
    const [clubDoc,squadSnap,transferSnap]=await Promise.all([
      db.collection('clubs').doc(req.user.clubId).get(),
      db.collection('players').where('clubId','==',req.user.clubId).get(),
      db.collection('transfers').orderBy('createdAt','desc').limit(20).get(),
    ]);
    const club=clubDoc.data();
    const players=squadSnap.docs.map(d=>({id:d.id,...d.data()}));
    const totalWages=players.reduce((s,p)=>s+p.salary,0);
    const totalValue=players.reduce((s,p)=>s+p.value,0);
    const transfers=transferSnap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>t.fromClubId===req.user.clubId||t.toClubId===req.user.clubId);
    res.json({club:{balance:club.balance,transferBudget:club.transferBudget,wageBudget:club.wageBudget},totalWages,totalValue,players,recentTransfers:transfers});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Leaderboards ─────────────────────────────────────────────────────────────
app.get('/api/leaderboards', auth, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('players').get();
    const allPlayers=snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>p.clubId&&p.clubId!=='free');
    const clubsSnap=await db.collection('clubs').get();
    const clubMap={};
    clubsSnap.docs.forEach(d=>clubMap[d.id]=d.data().name);
    const withClub=allPlayers.map(p=>({...p,clubName:clubMap[p.clubId]||'Unknown'}));
    res.json({
      topScorers:[...withClub].filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals).slice(0,20),
      topAssists:[...withClub].filter(p=>p.assists>0).sort((a,b)=>b.assists-a.assists).slice(0,20),
      highestOvr:[...withClub].sort((a,b)=>b.ovr-a.ovr).slice(0,20),
      mostValuable:[...withClub].sort((a,b)=>b.value-a.value).slice(0,20),
    });
  } catch(err){res.status(500).json({error:err.message});}
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('notifications').where('userId','==',req.user.id).orderBy('createdAt','desc').limit(50).get();
    const notifications=snap.docs.map(d=>({id:d.id,...d.data()}));
    res.json({notifications,unreadCount:notifications.filter(n=>!n.read).length});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/notifications/read-all', auth, async(req,res)=>{
  try {
    const db=getDb();
    const snap=await db.collection('notifications').where('userId','==',req.user.id).where('read','==',false).get();
    const batch=db.batch();
    snap.docs.forEach(d=>batch.update(d.ref,{read:true}));
    await batch.commit();
    res.json({success:true});
  } catch(err){res.status(500).json({error:err.message});}
});

async function createNotification(userId,type,title,message){
  const db=getDb();
  await db.collection('notifications').add({userId,type,title,message,read:false,createdAt:new Date().toISOString()});
}

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
let initialized=false;
async function bootstrap(){
  if(!initialized){
    try{await initializeGame();initialized=true;}
    catch(err){console.error('Init error:',err.message);}
  }
}

if(process.env.NODE_ENV!=='production'){
  const PORT=process.env.PORT||3000;
  bootstrap().then(()=>app.listen(PORT,()=>console.log(`Running on http://localhost:${PORT}`)));
}

module.exports=async(req,res)=>{await bootstrap();app(req,res);};
