/* ─── Top Eleven Style 2D Match Viewer ─────────────────────────────────────── */
(function(){
  var W=420, H=640, PR=9, BR=4, DUR=75000;
  var canvas, ctx, anim=null, st=null, paused=false, speed=1, lastTs=0;
  var passQ=[], passT=0;

  var FORM={
    '4-3-3':[[50,92],[15,74],[37,78],[63,78],[85,74],[30,52],[50,58],[70,52],[20,24],[50,18],[80,24]],
    '4-4-2':[[50,92],[15,74],[37,78],[63,78],[85,74],[15,48],[37,54],[63,54],[85,48],[37,22],[63,22]],
    '3-5-2':[[50,92],[25,78],[50,82],[75,78],[10,52],[35,56],[65,56],[90,52],[50,34],[37,18],[63,18]],
    '4-2-3-1':[[50,92],[15,74],[37,78],[63,78],[85,74],[37,58],[63,58],[20,36],[50,36],[80,36],[50,18]],
    'def':  [[50,92],[15,74],[37,78],[63,78],[85,74],[15,48],[37,54],[63,54],[85,48],[37,22],[63,22]]
  };

  var COL=[
    {s:'#22a06b',o:'#2ee08a'},
    {s:'#4a9eff',o:'#7ac0ff'}
  ];

  function mkPlayers(form,colIdx){
    var f=FORM[form]||FORM['def'];
    return f.map(function(p,i){
      return {
        id:colIdx+'_'+i, team:colIdx,
        x:p[0]/100*W, y:p[1]/100*H,
        bx:p[0]/100*W, by:p[1]/100*H,
        tx:p[0]/100*W, ty:p[1]/100*H,
        num:i+1
      };
    });
  }

  function genTimeline(evts){
    var tl=[], last=0;
    tl.push({type:'kickoff',min:0,dur:1500});
    var ev=(evts||[]).slice().sort(function(a,b){return a.minute-b.minute;});
    for(var i=0;i<ev.length;i++){
      var e=ev[i], gap=e.minute-last;
      if(gap>1){
        var n=Math.min(Math.floor(gap/2),6);
        for(var j=0;j<n;j++){
          var sm=last+(j+1)*(gap/(n+1));
          tl.push({type:'pass',min:sm,dur:2000+Math.random()*1200,
            team:Math.random()<0.5?0:1, passes:2+Math.floor(Math.random()*4),
            shot:Math.random()<0.2});
        }
      }
      if(e.type==='goal') tl.push({type:'goal',min:e.minute,dur:3500,team:e.team==='home'?0:1,scorer:e.player,assist:e.assist});
      else if(e.type==='yellow') tl.push({type:'foul',min:e.minute,dur:2000,team:e.team==='home'?0:1,player:e.player,card:'yellow'});
      else if(e.type==='red') tl.push({type:'foul',min:e.minute,dur:2500,team:e.team==='home'?0:1,player:e.player,card:'red'});
      last=e.minute;
    }
    var rem=90-last;
    if(rem>2){
      var n2=Math.min(Math.floor(rem/3),5);
      for(var k=0;k<n2;k++){
        tl.push({type:'pass',min:last+(k+1)*(rem/(n2+1)),dur:1800+Math.random()*1000,
          team:Math.random()<0.5?0:1,passes:2+Math.floor(Math.random()*3),shot:false});
      }
    }
    tl.push({type:'fulltime',min:90,dur:2000});
    tl.sort(function(a,b){return a.min-b.min;});
    return tl;
  }

  function init(canvasEl, matchData, homeForm, awayForm){
    canvas=canvasEl;
    ctx=canvas.getContext('2d');
    canvas.width=W; canvas.height=H;
    canvas.style.width=W+'px'; canvas.style.height=H+'px';

    var hp=mkPlayers(homeForm,0);
    var ap=mkPlayers(awayForm,1);
    var tl=genTimeline(matchData.events);

    st={
      hp:hp, ap:ap, all:hp.concat(ap),
      ball:{x:W/2,y:H/2,vx:0,vy:0,owner:null,flying:false,trail:[]},
      tl:tl, ti:0, mt:0, rt:0,
      hc:COL[0], ac:COL[1],
      score:[0,0], comm:[],
      action:'kickoff', celeb:0, gteam:-1,
      done:false,
      homeForm:homeForm, awayForm:awayForm
    };
    addComm(0,'The match is underway!','kickoff');
    paused=false; speed=1; lastTs=0; passQ=[]; passT=0;
  }

  function addComm(min,txt,type){
    if(!st) return;
    st.comm.unshift({min:min,txt:txt,type:type});
    if(st.comm.length>30) st.comm.pop();
    var el=document.getElementById('mv-commentary-list')||document.getElementById('cl');
    if(!el) return;
    el.innerHTML=st.comm.map(function(c){
      var icon=c.type==='goal'?'&#9917;':c.type==='yellow'?'&#9888;':c.type==='red'?'&#10060;':c.type==='fulltime'?'&#127942;':'&#9654;';
      var cls=c.type==='goal'?'commentary-item commentary-goal':c.type==='fulltime'?'commentary-item commentary-fulltime':'commentary-item';
      return '<div class="'+cls+'"><span class="commentary-min">'+c.min+"'"+'</span><span class="commentary-icon">'+icon+'</span><span class="commentary-text">'+c.txt+'</span></div>';
    }).join('');
  }

  function startSeq(act){
    var team=act.team;
    var players=team===0?st.hp:st.ap;
    var outfield=players.filter(function(_,i){return i>0;});
    if(!outfield.length) return;
    pushFwd(team);
    passQ=[];
    var np=act.passes||3;
    var holder=outfield[Math.floor(Math.random()*outfield.length)];
    for(var i=0;i<np;i++){
      var cands=players.filter(function(p){return p!==holder;});
      if(!cands.length) break;
      var w=cands.map(function(r){return team===0?(H-r.by):r.by;});
      var tot=w.reduce(function(a,b){return a+b;},0);
      var r=Math.random()*tot, recv=cands[0];
      for(var j=0;j<cands.length;j++){r-=w[j];if(r<=0){recv=cands[j];break;}}
      passQ.push({from:holder,to:recv,time:350+Math.random()*250});
      holder=recv;
    }
    if(act.shot&&holder){
      var gy=team===0?0:H;
      passQ.push({from:holder,to:{x:W/2+(Math.random()-0.5)*50,y:gy,isGoal:true},time:500,isShot:true});
    }
    passT=0;
    st.ball.owner=holder;
    st.ball.flying=false;
  }

  function pushFwd(team){
    var ps=team===0?st.hp:st.ap;
    var sh=team===0?-25:25;
    for(var i=0;i<ps.length;i++){
      var p=ps[i];
      var af=team===0?(1-p.by/H):(p.by/H);
      p.ty=p.by+sh*af;
      p.tx=p.bx+(Math.random()-0.5)*18;
      p.tx=Math.max(PR*2,Math.min(W-PR*2,p.tx));
      p.ty=Math.max(PR*2,Math.min(H-PR*2,p.ty));
    }
    var op=team===0?st.ap:st.hp;
    for(var i=0;i<op.length;i++){
      var p=op[i];
      var df=team===0?(p.by/H):(1-p.by/H);
      p.ty=p.by+sh*0.3*df;
      p.tx=p.bx+(Math.random()-0.5)*8;
    }
  }

  function resetPos(){
    for(var i=0;i<st.all.length;i++){
      var p=st.all[i]; p.tx=p.bx; p.ty=p.by;
    }
    passQ=[]; passT=0;
  }

  function execAction(a){
    if(a.type==='kickoff'){
      st.action='kickoff'; resetPos();
      st.ball.x=W/2; st.ball.y=H/2;
      st.ball.owner=st.hp[9]; st.ball.flying=false;
    } else if(a.type==='pass'){
      st.action='passing'; startSeq(a);
    } else if(a.type==='goal'){
      st.action='goal'; st.celeb=3500; st.gteam=a.team;
      st.score[a.team]++;
      var hs=document.getElementById('mv-home-score')||document.getElementById('hs');
      var as=document.getElementById('mv-away-score')||document.getElementById('as');
      if(hs) hs.textContent=st.score[0];
      if(as) as.textContent=st.score[1];
      addComm(a.min,'GOAL! '+a.scorer+(a.assist?' (assist: '+a.assist+')':''),'goal');
      animGoal(a);
    } else if(a.type==='foul'){
      st.action='foul';
      addComm(a.min,(a.card==='yellow'?'Yellow card':'Red card')+' for '+a.player,a.card);
    } else if(a.type==='fulltime'){
      st.action='fulltime'; st.done=true;
      addComm(90,'Full Time!','fulltime');
    }
  }

  function animGoal(a){
    var team=a.team;
    var ps=team===0?st.hp:st.ap;
    var atk=ps.filter(function(p){return p.by<H*0.5;});
    var scorer=atk.length?atk[Math.floor(Math.random()*atk.length)]:ps[9];
    scorer.tx=W/2+(Math.random()-0.5)*30;
    scorer.ty=team===0?25:H-25;
    st.ball.owner=null; st.ball.flying=true;
    st.ball.x=scorer.x; st.ball.y=scorer.y;
    var gy=team===0?5:H-5;
    st.ball.vx=(scorer.tx-scorer.x)*0.03;
    st.ball.vy=(gy-scorer.y)*0.03;
    for(var i=0;i<ps.length;i++){
      if(ps[i]!==scorer){
        ps[i].tx=scorer.tx+(Math.random()-0.5)*50;
        ps[i].ty=scorer.ty+(Math.random()-0.5)*35;
      }
    }
    setTimeout(function(){if(st)resetPos();},3000);
  }

  function updatePass(dt){
    if(!passQ.length) return;
    passT+=dt;
    var cur=passQ[0];
    if(passT>=cur.time){
      passT=0; passQ.shift();
      if(cur.isShot){
        st.ball.owner=null; st.ball.flying=true;
        st.ball.vx=(cur.to.x-st.ball.x)*0.05;
        st.ball.vy=(cur.to.y-st.ball.y)*0.05;
        st.action='shot';
      } else {
        st.ball.owner=cur.to; st.ball.flying=false;
        st.ball.x=cur.to.x; st.ball.y=cur.to.y;
      }
    } else if(!cur.isShot){
      var t=passT/cur.time;
      if(t<0.7){
        st.ball.flying=true; st.ball.owner=null;
        var fx=cur.from.x||cur.from.bx, fy=cur.from.y||cur.from.by;
        var tx=cur.to.x||cur.to.bx, ty=cur.to.y||cur.to.by;
        st.ball.x=fx+(tx-fx)*(t/0.7);
        st.ball.y=fy+(ty-fy)*(t/0.7);
      }
    }
  }

  function updatePlayers(dt){
    var ds=dt/1000;
    updatePass(dt);
    for(var i=0;i<st.all.length;i++){
      var p=st.all[i];
      var dx=p.tx-p.x, dy=p.ty-p.y;
      p.x+=dx*2.5*ds; p.y+=dy*2.5*ds;
      p.x+=(Math.random()-0.5)*0.25;
      p.y+=(Math.random()-0.5)*0.25;
      p.x=Math.max(PR,Math.min(W-PR,p.x));
      p.y=Math.max(PR,Math.min(H-PR,p.y));
      if(st.ball.owner===p){
        st.ball.x=p.x; st.ball.y=p.y+5;
        st.ball.flying=false;
      }
    }
    if(st.ball.flying){
      st.ball.x+=st.ball.vx; st.ball.y+=st.ball.vy;
      st.ball.vx*=0.97; st.ball.vy*=0.97;
      st.ball.trail.push({x:st.ball.x,y:st.ball.y,a:0});
      if(st.ball.trail.length>10) st.ball.trail.shift();
    }
    for(var i=0;i<st.ball.trail.length;i++) st.ball.trail[i].a+=dt;
    st.ball.trail=st.ball.trail.filter(function(t){return t.a<300;});
  }

  function loop(ts){
    if(!st) return;
    if(!lastTs) lastTs=ts;
    var dt=(ts-lastTs)*speed;
    lastTs=ts;
    if(!paused&&!st.done){
      st.rt+=dt;
      var prog=Math.min(1,st.rt/DUR);
      st.mt=prog*90;
      if(st.ti<st.tl.length){
        var cur=st.tl[st.ti];
        var trig=(cur.min/90)*DUR;
        if(st.rt>=trig){ execAction(cur); st.ti++; }
      }
      updatePlayers(dt);
      if(st.celeb>0) st.celeb-=dt;
    }
    render();
    anim=requestAnimationFrame(loop);
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    drawPitch();
    drawPlayers();
    drawBall();
    drawCeleb();
    drawMinute();
  }

  function drawPitch(){
    var sh=H/12;
    for(var i=0;i<12;i++){
      ctx.fillStyle=i%2===0?'#1a6b40':'#1a7a48';
      ctx.fillRect(0,i*sh,W,sh);
    }
    ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1.5;
    var m=12;
    ctx.strokeRect(m,m,W-m*2,H-m*2);
    ctx.beginPath(); ctx.moveTo(m,H/2); ctx.lineTo(W-m,H/2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2,H/2,50,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(W/2,H/2,3,0,Math.PI*2); ctx.fill();
    var bw=160,bh=70;
    ctx.strokeRect((W-bw)/2,m,bw,bh);
    ctx.strokeRect((W-bw)/2,H-m-bh,bw,bh);
    var gw=80,gh=28;
    ctx.strokeRect((W-gw)/2,m,gw,gh);
    ctx.strokeRect((W-gw)/2,H-m-gh,gw,gh);
    ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2;
    var glw=50,glh=10;
    ctx.strokeRect((W-glw)/2,m-glh+2,glw,glh);
    ctx.strokeRect((W-glw)/2,H-m-2,glw,glh);
    ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(W/2,m+bh,30,0,Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2,H-m-bh,30,Math.PI,Math.PI*2); ctx.stroke();
    var cr=8;
    ctx.beginPath(); ctx.arc(m,m,cr,0,Math.PI/2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W-m,m,cr,Math.PI/2,Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(m,H-m,cr,-Math.PI/2,0); ctx.stroke();
    ctx.beginPath(); ctx.arc(W-m,H-m,cr,Math.PI,Math.PI*1.5); ctx.stroke();
  }

  function drawPlayers(){
    for(var i=0;i<st.all.length;i++){
      var p=st.all[i];
      var c=p.team===0?st.hc:st.ac;
      var own=st.ball.owner===p;
      ctx.fillStyle='rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(p.x+1,p.y+3,PR*0.8,PR*0.4,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=c.s;
      ctx.beginPath(); ctx.arc(p.x,p.y,PR,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=own?'#fff':c.o; ctx.lineWidth=own?2.5:1.5; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 8px Inter,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.num,p.x,p.y);
      if(own){
        var nm='P'+p.num;
        var nw=ctx.measureText(nm).width+8;
        ctx.fillStyle='rgba(0,0,0,0.7)';
        ctx.fillRect(p.x-nw/2,p.y-PR-13,nw,11);
        ctx.fillStyle='#fff'; ctx.font='bold 7px Inter,sans-serif';
        ctx.fillText(nm,p.x,p.y-PR-7);
      }
    }
  }

  function drawBall(){
    for(var i=0;i<st.ball.trail.length;i++){
      var t=st.ball.trail[i];
      var al=(1-t.a/300)*0.4;
      var r=BR*(1-t.a/300)*0.6;
      ctx.fillStyle='rgba(255,255,255,'+al+')';
      ctx.beginPath(); ctx.arc(t.x,t.y,r,0,Math.PI*2); ctx.fill();
    }
    if(st.ball.owner) return;
    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(st.ball.x+1,st.ball.y+2,BR*0.8,BR*0.4,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(st.ball.x,st.ball.y,BR,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#ccc'; ctx.lineWidth=0.5; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(st.ball.x-1,st.ball.y-1,BR*0.4,0,Math.PI*2); ctx.fill();
  }

  function drawCeleb(){
    if(st.celeb<=0) return;
    var al=Math.min(1,st.celeb/1000);
    var sc=1+(1-al)*0.3;
    ctx.save(); ctx.globalAlpha=al;
    ctx.font='bold '+Math.floor(34*sc)+'px Inter,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.fillText('GOAL!',W/2+2,H/2+2);
    ctx.fillStyle='#fff';
    ctx.fillText('GOAL!',W/2,H/2);
    ctx.restore();
    var pc=8, tm=(3500-st.celeb)/1000;
    for(var i=0;i<pc;i++){
      var ang=(i/pc)*Math.PI*2+tm;
      var dist=40+tm*50;
      var px=W/2+Math.cos(ang)*dist;
      var py=H/2+Math.sin(ang)*dist;
      var pa=Math.max(0,al-0.3);
      ctx.fillStyle=i%2===0?'rgba(255,215,0,'+pa+')':'rgba(255,255,255,'+pa+')';
      ctx.beginPath(); ctx.arc(px,py,3,0,Math.PI*2); ctx.fill();
    }
  }

  function drawMinute(){
    var min=Math.min(90,Math.floor(st.mt));
    ctx.fillStyle='rgba(0,0,0,0.7)';
    ctx.fillRect(W/2-28,0,56,20);
    ctx.fillStyle='#fff'; ctx.font='bold 12px Inter,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(min+"'",W/2,10);
    if(st.action==='foul'){
      ctx.fillStyle='rgba(0,0,0,0.6)';
      ctx.fillRect(W/2-35,H/2-12,70,24);
      ctx.fillStyle='#ffcc00'; ctx.font='bold 11px Inter,sans-serif';
      ctx.fillText('FOUL',W/2,H/2);
    }
  }

  // Public API
  window.MatchViewer = {
    init: init,
    start: function(){ lastTs=0; anim=requestAnimationFrame(loop); },
    stop: function(){ if(anim) cancelAnimationFrame(anim); anim=null; st=null; passQ=[]; passT=0; },
    setSpeed: function(s){ speed=s; },
    togglePause: function(){ paused=!paused; if(!paused) lastTs=0; return paused; },
    getState: function(){ return st; }
  };
})();
