/* ─── Top Eleven Style 2D Match Viewer ─────────────────────────────────────── */
/* Canvas-based animated match simulation with player circles, passing, shooting */

const MatchViewer = (function () {

  // ─── Constants ──────────────────────────────────────────────────────────────
  const PITCH_W = 420;
  const PITCH_H = 640;
  const PLAYER_R = 9;
  const BALL_R = 4;
  const MATCH_DURATION_MS = 75000; // 75s for 90 minutes at 1x
  const FPS = 60;

  // Formations (x%, y%) - y=0 is top (away goal), y=100 is bottom (home goal)
  const FORMATIONS = {
    '4-4-2': [
      { x: 50, y: 92 }, { x: 15, y: 74 }, { x: 37, y: 78 }, { x: 63, y: 78 }, { x: 85, y: 74 },
      { x: 15, y: 48 }, { x: 37, y: 54 }, { x: 63, y: 54 }, { x: 85, y: 48 },
      { x: 37, y: 22 }, { x: 63, y: 22 }
    ],
    '4-3-3': [
      { x: 50, y: 92 }, { x: 15, y: 74 }, { x: 37, y: 78 }, { x: 63, y: 78 }, { x: 85, y: 74 },
      { x: 30, y: 52 }, { x: 50, y: 58 }, { x: 70, y: 52 },
      { x: 20, y: 24 }, { x: 50, y: 18 }, { x: 80, y: 24 }
    ],
    '3-5-2': [
      { x: 50, y: 92 }, { x: 25, y: 78 }, { x: 50, y: 82 }, { x: 75, y: 78 },
      { x: 10, y: 52 }, { x: 35, y: 56 }, { x: 65, y: 56 }, { x: 90, y: 52 },
      { x: 50, y: 34 }, { x: 37, y: 18 }, { x: 63, y: 18 }
    ],
    '4-2-3-1': [
      { x: 50, y: 92 }, { x: 15, y: 74 }, { x: 37, y: 78 }, { x: 63, y: 78 }, { x: 85, y: 74 },
      { x: 37, y: 58 }, { x: 63, y: 58 },
      { x: 20, y: 36 }, { x: 50, y: 36 }, { x: 80, y: 36 },
      { x: 50, y: 18 }
    ],
    'default': [
      { x: 50, y: 92 }, { x: 15, y: 74 }, { x: 37, y: 78 }, { x: 63, y: 78 }, { x: 85, y: 74 },
      { x: 15, y: 48 }, { x: 37, y: 54 }, { x: 63, y: 54 }, { x: 85, y: 48 },
      { x: 37, y: 22 }, { x: 63, y: 22 }
    ]
  };

  // Team colors
  const TEAM_COLORS = [
    { shirt: '#22a06b', shorts: '#1a7a5a', outline: '#2ee08a' },
    { shirt: '#4a9eff', shorts: '#2a6acc', outline: '#7ac0ff' },
    { shirt: '#e05555', shorts: '#aa3333', outline: '#ff7777' },
    { shirt: '#e8c468', shorts: '#b89838', outline: '#ffe088' },
    { shirt: '#9966ff', shorts: '#6633cc', outline: '#bb99ff' },
    { shirt: '#ff8844', shorts: '#cc5522', outline: '#ffaa77' },
  ];

  // ─── State ──────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let animFrame = null;
  let state = null;

  // ─── Initialization ────────────────────────────────────────────────────────
  function init(canvasEl, matchData, homeFormation, awayFormation) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    // Set canvas resolution
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PITCH_W * dpr;
    canvas.height = PITCH_H * dpr;
    canvas.style.width = PITCH_W + 'px';
    canvas.style.height = PITCH_H + 'px';
    ctx.scale(dpr, dpr);

    const homeColor = TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];
    let awayColor = TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];
    // Ensure different colors
    while (awayColor.shirt === homeColor.shirt) {
      awayColor = TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];
    }

    const homeForm = FORMATIONS[homeFormation] || FORMATIONS['default'];
    const awayForm = FORMATIONS[awayFormation] || FORMATIONS['default'];

    // Create players
    const homePlayers = homeForm.map((pos, i) => ({
      id: 'h' + i, team: 0, x: pos.x / 100 * PITCH_W, y: pos.y / 100 * PITCH_H,
      baseX: pos.x / 100 * PITCH_W, baseY: pos.y / 100 * PITCH_H,
      targetX: pos.x / 100 * PITCH_W, targetY: pos.y / 100 * PITCH_H,
      vx: 0, vy: 0, number: i + 1,
      name: matchData.homePlayers?.[i] || ('Player ' + (i + 1))
    }));

    const awayPlayers = awayForm.map((pos, i) => ({
      id: 'a' + i, team: 1, x: pos.x / 100 * PITCH_W, y: pos.y / 100 * PITCH_H,
      baseX: pos.x / 100 * PITCH_W, baseY: pos.y / 100 * PITCH_H,
      targetX: pos.x / 100 * PITCH_W, targetY: pos.y / 100 * PITCH_H,
      vx: 0, vy: 0, number: i + 1,
      name: matchData.awayPlayers?.[i] || ('Player ' + (i + 1))
    }));

    // Generate visual timeline
    const timeline = generateTimeline(matchData);

    state = {
      matchData,
      homePlayers,
      awayPlayers,
      allPlayers: [...homePlayers, ...awayPlayers],
      ball: { x: PITCH_W / 2, y: PITCH_H / 2, vx: 0, vy: 0, owner: null, inFlight: false, trail: [] },
      timeline,
      timelineIdx: 0,
      matchTime: 0,        // 0-90 in game minutes
      realTime: 0,         // real ms elapsed
      speed: 1,
      paused: false,
      lastTimestamp: 0,
      homeColor,
      awayColor,
      colors: [homeColor, awayColor],
      score: [0, 0],
      commentary: [],
      currentAction: 'kickoff',
      actionTimer: 0,
      goalCelebration: 0,
      goalTeam: -1,
      finished: false,
      homeFormation,
      awayFormation,
      homeName: matchData.homeName || 'Home',
      awayName: matchData.awayName || 'Away',
    };

    addCommentary(0, 'The match is underway!', 'kickoff');
    return state;
  }

  // ─── Timeline Generation ───────────────────────────────────────────────────
  // Generates a sequence of visual actions from the match events
  function generateTimeline(matchData) {
    const events = (matchData.events || []).slice().sort((a, b) => a.minute - b.minute);
    const timeline = [];
    let lastMinute = 0;

    // Kickoff
    timeline.push({ type: 'kickoff', minute: 0, duration: 1500 });

    for (const evt of events) {
      // Fill gap before this event with passing sequences
      const gap = evt.minute - lastMinute;
      if (gap > 1) {
        const numSequences = Math.min(Math.floor(gap / 2), 8);
        for (let i = 0; i < numSequences; i++) {
          const seqMin = lastMinute + (i + 1) * (gap / (numSequences + 1));
          const attackingTeam = Math.random() < 0.5 ? 0 : 1;
          const numPasses = 2 + Math.floor(Math.random() * 5);
          timeline.push({
            type: 'passing', minute: seqMin, duration: 2000 + Math.random() * 1500,
            team: attackingTeam, passes: numPasses,
            endsWithShot: Math.random() < 0.25,
          });
        }
      }

      // Add the actual event
      if (evt.type === 'goal') {
        const team = evt.team === 'home' ? 0 : 1;
        timeline.push({
          type: 'goal', minute: evt.minute, duration: 3500,
          team, scorer: evt.player, assister: evt.assist,
        });
      } else if (evt.type === 'yellow') {
        timeline.push({
          type: 'foul', minute: evt.minute, duration: 2000,
          team: evt.team === 'home' ? 0 : 1, player: evt.player, card: 'yellow',
        });
      } else if (evt.type === 'red') {
        timeline.push({
          type: 'foul', minute: evt.minute, duration: 2500,
          team: evt.team === 'home' ? 0 : 1, player: evt.player, card: 'red',
        });
      }

      lastMinute = evt.minute;
    }

    // Fill remaining time with passing sequences
    const remaining = 90 - lastMinute;
    if (remaining > 2) {
      const numSeq = Math.min(Math.floor(remaining / 3), 6);
      for (let i = 0; i < numSeq; i++) {
        const seqMin = lastMinute + (i + 1) * (remaining / (numSeq + 1));
        timeline.push({
          type: 'passing', minute: seqMin, duration: 2000 + Math.random() * 1000,
          team: Math.random() < 0.5 ? 0 : 1, passes: 2 + Math.floor(Math.random() * 4),
          endsWithShot: false,
        });
      }
    }

    // Full time
    timeline.push({ type: 'fulltime', minute: 90, duration: 2000 });

    // Sort by minute
    timeline.sort((a, b) => a.minute - b.minute);
    return timeline;
  }

  // ─── Update Loop ───────────────────────────────────────────────────────────
  function update(timestamp) {
    if (!state) return;
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;

    const dt = (timestamp - state.lastTimestamp) * state.speed;
    state.lastTimestamp = timestamp;

    if (!state.paused && !state.finished) {
      state.realTime += dt;

      // Calculate match time (0-90)
      const progress = Math.min(1, state.realTime / MATCH_DURATION_MS);
      state.matchTime = progress * 90;

      // Process timeline
      processTimeline(dt);

      // Update player positions
      updatePlayers(dt);

      // Update ball
      updateBall(dt);

      // Goal celebration timer
      if (state.goalCelebration > 0) {
        state.goalCelebration -= dt;
      }
    }

    // Render
    render();

    animFrame = requestAnimationFrame(update);
  }

  function processTimeline(dt) {
    if (state.timelineIdx >= state.timeline.length) {
      if (state.matchTime >= 90) {
        state.finished = true;
        state.currentAction = 'fulltime';
        return;
      }
      return;
    }

    const current = state.timeline[state.timelineIdx];
    const triggerTime = (current.minute / 90) * MATCH_DURATION_MS;

    if (state.realTime >= triggerTime) {
      executeAction(current);
      state.timelineIdx++;
    }
  }

  function executeAction(action) {
    switch (action.type) {
      case 'kickoff':
        state.currentAction = 'kickoff';
        resetPositions();
        // Ball to center
        state.ball.x = PITCH_W / 2;
        state.ball.y = PITCH_H / 2;
        state.ball.owner = state.homePlayers[9]; // ST
        state.ball.inFlight = false;
        break;

      case 'passing':
        state.currentAction = 'passing';
        startPassingSequence(action);
        break;

      case 'goal':
        state.currentAction = 'goal';
        state.goalCelebration = 3500;
        state.goalTeam = action.team;
        state.score[action.team]++;
        updateScoreboard();
        addCommentary(action.minute, `GOAL! ${action.scorer}${action.assister ? ' (assist: ' + action.assister + ')' : ''}`, 'goal');
        animateGoal(action);
        break;

      case 'foul':
        state.currentAction = 'foul';
        addCommentary(action.minute, `${action.card === 'yellow' ? 'Yellow card' : 'Red card'} for ${action.player}`, action.card);
        break;

      case 'fulltime':
        state.currentAction = 'fulltime';
        state.finished = true;
        addCommentary(90, 'Full Time!', 'fulltime');
        break;
    }
  }

  // ─── Passing Sequences ─────────────────────────────────────────────────────
  let passQueue = [];
  let passTimer = 0;

  function startPassingSequence(action) {
    const team = action.team;
    const players = team === 0 ? state.homePlayers : state.awayPlayers;
    const oppPlayers = team === 0 ? state.awayPlayers : state.homePlayers;

    // Push attacking team forward
    pushTeamForward(team);

    // Build pass chain
    passQueue = [];
    const numPasses = action.passes || 3;
    let currentHolder = getRandomOutfieldPlayer(players);

    // Determine direction: team 0 attacks upward (y decreases), team 1 attacks downward
    const attackDir = team === 0 ? -1 : 1;

    for (let i = 0; i < numPasses; i++) {
      // Pick a receiver more toward the attacking direction
      const receivers = players.filter(p => p !== currentHolder && p.baseY < PITCH_H * 0.85);
      if (receivers.length === 0) break;

      // Prefer players further up the pitch
      const weighted = receivers.map(r => ({
        player: r,
        weight: team === 0 ? (PITCH_H - r.baseY) : r.baseY
      }));
      const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
      let r = Math.random() * totalWeight;
      let receiver = weighted[0].player;
      for (const w of weighted) {
        r -= w.weight;
        if (r <= 0) { receiver = w.player; break; }
      }

      passQueue.push({
        from: currentHolder,
        to: receiver,
        time: 400 + Math.random() * 300,
      });
      currentHolder = receiver;
    }

    // End with shot?
    if (action.endsWithShot && currentHolder) {
      const goalY = team === 0 ? 0 : PITCH_H;
      passQueue.push({
        from: currentHolder,
        to: { x: PITCH_W / 2 + (Math.random() - 0.5) * 60, y: goalY, isGoal: true },
        time: 600,
        isShot: true,
      });
    }

    passTimer = 0;
    state.ball.owner = currentHolder;
    state.ball.inFlight = false;
  }

  function updatePassing(dt) {
    if (passQueue.length === 0) return;

    passTimer += dt;
    const current = passQueue[0];

    if (passTimer >= current.time) {
      passTimer = 0;
      passQueue.shift();

      if (current.isShot) {
        // Animate shot
        state.ball.owner = null;
        state.ball.inFlight = true;
        state.ball.vx = (current.to.x - state.ball.x) * 0.05;
        state.ball.vy = (current.to.y - state.ball.y) * 0.05;
        state.currentAction = 'shot';
      } else {
        // Complete pass
        state.ball.owner = current.to;
        state.ball.inFlight = false;
        state.ball.x = current.to.x;
        state.ball.y = current.to.y;
      }
    } else if (current.from && current.to && !current.isShot) {
      // Animate ball in flight between players
      const t = passTimer / current.time;
      if (t < 0.7) {
        // Ball in flight
        state.ball.inFlight = true;
        state.ball.owner = null;
        const fromX = current.from.x || current.from.baseX;
        const fromY = current.from.y || current.from.baseY;
        const toX = current.to.x || current.to.baseX;
        const toY = current.to.y || current.to.baseY;
        state.ball.x = fromX + (toX - fromX) * (t / 0.7);
        state.ball.y = fromY + (toY - fromY) * (t / 0.7);
      }
    }
  }

  // ─── Goal Animation ────────────────────────────────────────────────────────
  function animateGoal(action) {
    const team = action.team;
    const players = team === 0 ? state.homePlayers : state.awayPlayers;
    const goalY = team === 0 ? 8 : PITCH_H - 8;
    const goalX = PITCH_W / 2 + (Math.random() - 0.5) * 40;

    // Find the scorer (random outfield player pushed forward)
    const attackers = players.filter(p => p.baseY < PITCH_H * 0.5);
    const scorer = attackers.length > 0 ? attackers[Math.floor(Math.random() * attackers.length)] : players[9];

    // Move scorer toward goal
    scorer.targetX = goalX;
    scorer.targetY = team === 0 ? 30 : PITCH_H - 30;

    // Ball to goal
    state.ball.owner = null;
    state.ball.inFlight = true;
    state.ball.x = scorer.x;
    state.ball.y = scorer.y;
    state.ball.vx = (goalX - scorer.x) * 0.03;
    state.ball.vy = (goalY - scorer.y) * 0.03;

    // Other attackers rush toward scorer for celebration
    for (const p of players) {
      if (p !== scorer) {
        p.targetX = scorer.targetX + (Math.random() - 0.5) * 60;
        p.targetY = scorer.targetY + (Math.random() - 0.5) * 40;
      }
    }

    // Reset after celebration
    setTimeout(() => {
      if (state) resetPositions();
    }, 3000);
  }

  // ─── Player Movement ───────────────────────────────────────────────────────
  function updatePlayers(dt) {
    const dtSec = dt / 1000;

    updatePassing(dt);

    for (const player of state.allPlayers) {
      // Add subtle idle movement
      if (state.currentAction === 'passing' || state.currentAction === 'kickoff') {
        // Drift toward target
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        player.x += dx * 2.5 * dtSec;
        player.y += dy * 2.5 * dtSec;
      }

      // Small random jitter for liveliness
      player.x += (Math.random() - 0.5) * 0.3;
      player.y += (Math.random() - 0.5) * 0.3;

      // Keep in bounds
      player.x = Math.max(PLAYER_R, Math.min(PITCH_W - PLAYER_R, player.x));
      player.y = Math.max(PLAYER_R, Math.min(PITCH_H - PLAYER_R, player.y));

      // If player owns the ball, ball follows
      if (state.ball.owner === player) {
        state.ball.x = player.x + (player.team === 0 ? 0 : 0);
        state.ball.y = player.y + 5;
        state.ball.inFlight = false;
      }
    }

    // Ball physics when in flight
    if (state.ball.inFlight) {
      state.ball.x += state.ball.vx;
      state.ball.y += state.ball.vy;
      state.ball.vx *= 0.97;
      state.ball.vy *= 0.97;

      // Trail
      state.ball.trail.push({ x: state.ball.x, y: state.ball.y, age: 0 });
      if (state.ball.trail.length > 12) state.ball.trail.shift();
    }

    // Age trail
    for (const t of state.ball.trail) t.age += dt;
    state.ball.trail = state.ball.trail.filter(t => t.age < 300);
  }

  function pushTeamForward(team) {
    const players = team === 0 ? state.homePlayers : state.awayPlayers;
    const shift = team === 0 ? -30 : 30;

    for (const p of players) {
      // Shift toward attacking direction, more for attacking players
      const attackFactor = team === 0 ? (1 - p.baseY / PITCH_H) : (p.baseY / PITCH_H);
      p.targetY = p.baseY + shift * attackFactor;
      p.targetX = p.baseX + (Math.random() - 0.5) * 20;
      p.targetX = Math.max(PLAYER_R * 2, Math.min(PITCH_W - PLAYER_R * 2, p.targetX));
      p.targetY = Math.max(PLAYER_R * 2, Math.min(PITCH_H - PLAYER_R * 2, p.targetY));
    }

    // Opposing team drops back slightly
    const oppPlayers = team === 0 ? state.awayPlayers : state.homePlayers;
    for (const p of oppPlayers) {
      const defFactor = team === 0 ? (p.baseY / PITCH_H) : (1 - p.baseY / PITCH_H);
      p.targetY = p.baseY + shift * 0.3 * defFactor;
      p.targetX = p.baseX + (Math.random() - 0.5) * 10;
    }
  }

  function resetPositions() {
    for (const p of state.allPlayers) {
      p.targetX = p.baseX;
      p.targetY = p.baseY;
    }
    passQueue = [];
    passTimer = 0;
  }

  function getRandomOutfieldPlayer(players) {
    const outfield = players.filter((_, i) => i > 0); // skip GK
    return outfield[Math.floor(Math.random() * outfield.length)] || players[0];
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, PITCH_W, PITCH_H);
    drawPitch();
    drawPlayers();
    drawBall();
    drawGoalCelebration();
    drawOverlay();
  }

  function drawPitch() {
    // Grass with stripes
    const stripeH = PITCH_H / 12;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1a6b40' : '#1a7a48';
      ctx.fillRect(0, i * stripeH, PITCH_W, stripeH);
    }

    // Markings
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;

    // Outline
    const m = 12;
    ctx.strokeRect(m, m, PITCH_W - m * 2, PITCH_H - m * 2);

    // Center line
    ctx.beginPath();
    ctx.moveTo(m, PITCH_H / 2);
    ctx.lineTo(PITCH_W - m, PITCH_H / 2);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(PITCH_W / 2, PITCH_H / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Center spot
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(PITCH_W / 2, PITCH_H / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Penalty boxes
    const boxW = 160;
    const boxH = 70;
    ctx.strokeRect((PITCH_W - boxW) / 2, m, boxW, boxH);
    ctx.strokeRect((PITCH_W - boxW) / 2, PITCH_H - m - boxH, boxW, boxH);

    // Goal areas
    const goalAreaW = 80;
    const goalAreaH = 28;
    ctx.strokeRect((PITCH_W - goalAreaW) / 2, m, goalAreaW, goalAreaH);
    ctx.strokeRect((PITCH_W - goalAreaW) / 2, PITCH_H - m - goalAreaH, goalAreaW, goalAreaH);

    // Goals
    const goalW = 50;
    const goalH = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect((PITCH_W - goalW) / 2, m - goalH + 2, goalW, goalH);
    ctx.strokeRect((PITCH_W - goalW) / 2, PITCH_H - m - 2, goalW, goalH);

    // Penalty arcs
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(PITCH_W / 2, m + boxH, 30, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(PITCH_W / 2, PITCH_H - m - boxH, 30, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Corner arcs
    const cr = 8;
    ctx.beginPath(); ctx.arc(m, m, cr, 0, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(PITCH_W - m, m, cr, Math.PI / 2, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(m, PITCH_H - m, cr, -Math.PI / 2, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(PITCH_W - m, PITCH_H - m, cr, Math.PI, Math.PI * 1.5); ctx.stroke();
  }

  function drawPlayers() {
    for (const player of state.allPlayers) {
      const colors = state.colors[player.team];
      const isOwner = state.ball.owner === player;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(player.x + 1, player.y + 3, PLAYER_R * 0.8, PLAYER_R * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Player circle (shirt)
      ctx.fillStyle = colors.shirt;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();

      // Outline
      ctx.strokeStyle = isOwner ? '#ffffff' : colors.outline;
      ctx.lineWidth = isOwner ? 2.5 : 1.5;
      ctx.stroke();

      // Number
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.number, player.x, player.y);

      // Name label (only for ball owner or during goal)
      if (isOwner || (state.goalCelebration > 0 && player.team === state.goalTeam)) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        const nameWidth = ctx.measureText(player.name.split(' ').pop()).width + 8;
        ctx.fillRect(player.x - nameWidth / 2, player.y - PLAYER_R - 14, nameWidth, 12);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px Inter, sans-serif';
        ctx.fillText(player.name.split(' ').pop(), player.x, player.y - PLAYER_R - 8);
      }
    }
  }

  function drawBall() {
    // Trail
    for (let i = 0; i < state.ball.trail.length; i++) {
      const t = state.ball.trail[i];
      const alpha = (1 - t.age / 300) * 0.4;
      const r = BALL_R * (1 - t.age / 300) * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.ball.owner) return; // Ball drawn at player position

    // Ball shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(state.ball.x + 1, state.ball.y + 2, BALL_R * 0.8, BALL_R * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ball
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Ball highlight
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(state.ball.x - 1, state.ball.y - 1, BALL_R * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGoalCelebration() {
    if (state.goalCelebration <= 0) return;

    const alpha = Math.min(1, state.goalCelebration / 1000);
    const scale = 1 + (1 - alpha) * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = state.goalTeam === 0 ? state.homeColor.shirt : state.awayColor.shirt;
    ctx.font = `bold ${Math.floor(36 * scale)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('GOAL!', PITCH_W / 2 + 2, PITCH_H / 2 + 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillText('GOAL!', PITCH_W / 2, PITCH_H / 2);
    ctx.restore();

    // Particle effects
    const particleCount = 8;
    const time = (3500 - state.goalCelebration) / 1000;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + time;
      const dist = 40 + time * 50;
      const px = PITCH_W / 2 + Math.cos(angle) * dist;
      const py = PITCH_H / 2 + Math.sin(angle) * dist;
      const pAlpha = Math.max(0, alpha - 0.3);
      ctx.fillStyle = i % 2 === 0 ? `rgba(255,215,0,${pAlpha})` : `rgba(255,255,255,${pAlpha})`;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOverlay() {
    // Minute display at top
    const minute = Math.min(90, Math.floor(state.matchTime));
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(PITCH_W / 2 - 30, 0, 60, 22);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(minute + "'", PITCH_W / 2, 11);

    // Action indicator
    if (state.currentAction === 'foul') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(PITCH_W / 2 - 40, PITCH_H / 2 - 15, 80, 30);
      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText('FOUL', PITCH_W / 2, PITCH_H / 2);
    }
  }

  // ─── Commentary ────────────────────────────────────────────────────────────
  function addCommentary(minute, text, type) {
    if (!state) return;
    state.commentary.unshift({ minute, text, type, time: Date.now() });
    if (state.commentary.length > 30) state.commentary.pop();

    // Update DOM commentary
    const el = document.getElementById('mv-commentary-list');
    if (el) {
      el.innerHTML = state.commentary.map(c => {
        const icon = c.type === 'goal' ? '&#9917;' : c.type === 'yellow' ? '&#9888;' : c.type === 'red' ? '&#10060;' : c.type === 'fulltime' ? '&#127942;' : '&#9654;';
        const cls = c.type === 'goal' ? 'commentary-goal' : c.type === 'fulltime' ? 'commentary-fulltime' : '';
        return `<div class="commentary-item ${cls}"><span class="commentary-min">${c.minute}'</span><span class="commentary-icon">${icon}</span><span class="commentary-text">${c.text}</span></div>`;
      }).join('');
    }
  }

  function updateScoreboard() {
    const homeScoreEl = document.getElementById('mv-home-score');
    const awayScoreEl = document.getElementById('mv-away-score');
    if (homeScoreEl) homeScoreEl.textContent = state.score[0];
    if (awayScoreEl) awayScoreEl.textContent = state.score[1];
  }

  // ─── Controls ──────────────────────────────────────────────────────────────
  function setSpeed(s) {
    if (state) state.speed = s;
  }

  function togglePause() {
    if (state) {
      state.paused = !state.paused;
      if (!state.paused) state.lastTimestamp = 0;
    }
    return state ? state.paused : false;
  }

  function stop() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    state = null;
    passQueue = [];
    passTimer = 0;
  }

  function start() {
    state.lastTimestamp = 0;
    animFrame = requestAnimationFrame(update);
  }

  function getState() { return state; }

  // ─── Public API ────────────────────────────────────────────────────────────
  return { init, start, stop, setSpeed, togglePause, getState };
})();
