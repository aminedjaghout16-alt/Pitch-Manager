/* ─── Pitch Manager - Top Eleven Style App ─────────────────────────────── */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('pm_token'),
  user: null,
  club: null,
  currentSection: 'home',
  currentSubTab: null,
  squadSort: { col: 'ovr', order: 'desc' },
  squadFilter: '',
  transferSort: { col: 'ovr', order: 'desc' },
  transferFilter: '',
  trainingFocus: 'general',
  leaderboardTab: 'scorers',
  tacticsState: {
    formation: '4-4-2',
    mentality: 'balanced',
    pressing: 'normal',
    tempo: 'normal',
    passingStyle: 'mixed',
    captainId: null,
    lineup: {},
    players: [],
    selectedSlot: null,
  },
  matchViewerCloseCallback: null,
};

// ─── API Client ──────────────────────────────────────────────────────────────
const api = {
  async request(method, path, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Server returned a non-JSON response');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
};

// ─── Utility Functions ───────────────────────────────────────────────────────
function formatMoney(n) {
  if (n == null) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n < 0 ? '-' : '') + '$' + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return (n < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(0) + 'K';
  return '$' + n.toLocaleString();
}

function ovrClass(ovr) {
  if (ovr >= 75) return 'ovr-high';
  if (ovr >= 60) return 'ovr-mid';
  return 'ovr-low';
}

function barColor(val) {
  if (val >= 70) return 'bar-green';
  if (val >= 40) return 'bar-gold';
  return 'bar-red';
}

function playerAvatarUrl(p) {
  const seed = encodeURIComponent(String(p?.id ?? `${p?.firstName ?? ''}${p?.lastName ?? ''}` ?? 'player'));
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&radius=50&backgroundType=gradientLinear&backgroundColor=2a2a3a,1a1a2a`;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

function openActionSheet(title, items) {
  document.getElementById('action-sheet-title').textContent = title;
  document.getElementById('action-sheet-content').innerHTML = items.map(item =>
    `<div class="action-sheet-item ${item.danger ? 'danger' : ''}" onclick="${item.onclick}">
      <span class="icon">${item.icon || ''}</span>
      <span>${item.label}</span>
    </div>`
  ).join('');
  document.getElementById('action-sheet-overlay').classList.add('show');
}

function closeActionSheet() {
  document.getElementById('action-sheet-overlay').classList.remove('show');
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('login-error').textContent = '';
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
  document.getElementById('register-error').textContent = '';
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'All fields are required'; return; }
  try {
    const data = await api.post('/auth/login', { username, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('pm_token', data.token);
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function handleRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  if (!username || !email || !password) { errEl.textContent = 'All fields are required'; return; }
  try {
    const data = await api.post('/auth/register', { username, email, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('pm_token', data.token);
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function handleCreateClub() {
  const name = document.getElementById('club-name').value.trim();
  const stadium = document.getElementById('club-stadium').value.trim();
  const city = document.getElementById('club-city').value.trim();
  const errEl = document.getElementById('club-create-error');
  errEl.textContent = '';
  if (!name || !stadium || !city) { errEl.textContent = 'All fields are required'; return; }
  try {
    const data = await api.post('/club/create', { name, stadium, city });
    state.user.clubId = data.club.id;
    state.club = data.club;
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function handleLogout() {
  stopMatchPolling();
  state.token = null;
  state.user = null;
  state.club = null;
  localStorage.removeItem('pm_token');
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  showLogin();
}

// ─── App Initialization ─────────────────────────────────────────────────────
async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('club-create-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  try {
    if (!state.user) {
      const data = await api.get('/auth/me');
      state.user = data.user;
    }
    if (!state.user.clubId) {
      document.getElementById('app').style.display = 'none';
      document.getElementById('club-create-screen').style.display = 'flex';
      return;
    }
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateTopBar();
    switchSection('home');
  } catch (e) {
    handleLogout();
  }
}

function updateTopBar() {
  if (!state.club) return;
  document.getElementById('top-bar-club-name').textContent = state.club.name;
  document.getElementById('top-bar-balance').textContent = formatMoney(state.club.balance);
  const badge = document.getElementById('top-bar-badge');
  badge.style.background = `linear-gradient(135deg, var(--green), var(--green-light))`;
}

// ─── Section Navigation ─────────────────────────────────────────────────────
function switchSection(section) {
  state.currentSection = section;
  state.currentSubTab = null;

  // Stop polling when leaving matches/home
  if (section !== 'matches' && section !== 'home') {
    stopMatchPolling();
  }

  // Update bottom nav
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.section === section);
  });

  // Update sub nav
  updateSubNav(section);

  // Render section
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const renderers = {
    home: renderHome,
    squad: renderSquadSection,
    matches: renderMatchesSection,
    transfers: renderTransfersSection,
    club: renderClubSection,
  };

  const render = renderers[section] || renderHome;
  render(main);
}

function updateSubNav(section) {
  const subNav = document.getElementById('sub-nav');
  const main = document.getElementById('main-content');

  const subTabs = {
    home: [],
    squad: [
      { id: 'overview', label: 'Overview' },
      { id: 'formation', label: 'Formation' },
      { id: 'list', label: 'All Players' },
      { id: 'injuries', label: 'Medical' },
    ],
    matches: [
      { id: 'next', label: 'Next Match' },
      { id: 'results', label: 'Results' },
      { id: 'league', label: 'League' },
      { id: 'stats', label: 'Stats' },
    ],
    transfers: [
      { id: 'market', label: 'Market' },
      { id: 'listed', label: 'Listed' },
      { id: 'history', label: 'History' },
    ],
    club: [
      { id: 'overview', label: 'Overview' },
      { id: 'finances', label: 'Finances' },
      { id: 'training', label: 'Training' },
      { id: 'tactics', label: 'Tactics' },
      { id: 'awards', label: 'Awards' },
    ],
  };

  const tabs = subTabs[section] || [];

  if (tabs.length === 0) {
    subNav.style.display = 'none';
    main.classList.remove('with-sub-nav');
    return;
  }

  subNav.style.display = 'flex';
  main.classList.add('with-sub-nav');
  state.currentSubTab = tabs[0].id;

  subNav.innerHTML = tabs.map(t =>
    `<button class="sub-nav-tab ${t.id === state.currentSubTab ? 'active' : ''}" onclick="switchSubTab('${t.id}')">${t.label}</button>`
  ).join('');
}

function switchSubTab(tab) {
  state.currentSubTab = tab;

  // Update sub nav active state
  document.querySelectorAll('.sub-nav-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().replace(' ', '') === tab.toLowerCase().replace(' ', '') || t.onclick.toString().includes(`'${tab}'`));
  });

  // Re-render current section
  const main = document.getElementById('main-content');
  const renderers = {
    home: renderHome,
    squad: renderSquadSection,
    matches: renderMatchesSection,
    transfers: renderTransfersSection,
    club: renderClubSection,
  };

  const render = renderers[state.currentSection] || renderHome;
  render(main);
}

// ─── HOME / DASHBOARD ────────────────────────────────────────────────────────
async function renderHome(container) {
  try {
    const data = await api.get('/dashboard');
    const { club, season, standing, nextMatch, lastMatch, totalWages } = data;
    state.club = club;
    updateTopBar();

    // Get squad summary
    const squadData = await api.get('/squad?sort=ovr&order=desc');
    const avgOvr = squadData.players.length > 0
      ? Math.round(squadData.players.reduce((s, p) => s + p.ovr, 0) / squadData.players.length)
      : 0;

    // Get league data for position count
    const leagueData = await api.get('/league');
    const totalClubs = leagueData.standings.length || 20;

    let nextMatchHtml = '';
    if (nextMatch) {
      const isHome = nextMatch.homeTeamId === club.id;
      const oppName = isHome ? (nextMatch.awayName || 'Away') : (nextMatch.homeName || 'Home');
      nextMatchHtml = `
        <div class="next-match-card">
          <div class="next-match-label">
            <span class="live-dot"></span>
            Next Match &middot; Matchday ${season.currentMatchday}
          </div>
          <div class="next-match-teams">
            <div class="next-match-team">
              <div class="next-match-team-badge" style="background:linear-gradient(135deg, var(--green), var(--green-light))">&#9917;</div>
              <div class="next-match-team-name">${isHome ? club.name : oppName}</div>
            </div>
            <div class="next-match-vs">VS</div>
            <div class="next-match-team">
              <div class="next-match-team-badge" style="background:linear-gradient(135deg, #4a9eff, #2a6acc)">&#9917;</div>
              <div class="next-match-team-name">${isHome ? oppName : club.name}</div>
            </div>
          </div>
          <div class="next-match-action">
            <button class="btn btn-primary" onclick="switchSection('matches')">Match Center</button>
          </div>
        </div>
      `;
    } else {
      nextMatchHtml = `
        <div class="next-match-card">
          <div class="next-match-label">Season Complete</div>
          <p class="text-muted text-sm">All matches have been played. Check the league table for final standings.</p>
          <div class="next-match-action mt-8">
            <button class="btn btn-ghost btn-sm" onclick="switchSection('matches');setTimeout(()=>switchSubTab('league'),50)">View League</button>
          </div>
        </div>
      `;
    }

    let lastResultHtml = '';
    if (lastMatch) {
      const isHome = lastMatch.homeTeamId === club.id;
      const userGoals = isHome ? lastMatch.homeGoals : lastMatch.awayGoals;
      const oppGoals = isHome ? lastMatch.awayGoals : lastMatch.homeGoals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';
      const resultLabel = result === 'W' ? 'Victory' : result === 'D' ? 'Draw' : 'Defeat';

      lastResultHtml = `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Last Result</span>
            <span class="result-badge result-${result}" style="width:auto;padding:4px 10px;font-size:11px">${resultLabel} ${userGoals}-${oppGoals}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
            <span style="font-weight:600">${lastMatch.homeName || 'Home'}</span>
            <span style="font-weight:900;color:var(--gold);font-size:16px;letter-spacing:2px">${lastMatch.homeGoals} - ${lastMatch.awayGoals}</span>
            <span style="font-weight:600">${lastMatch.awayName || 'Away'}</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="home-hero">
        <div class="home-hero-top">
          <div>
            <div class="home-hero-greeting">Season ${season.id || season.seasonNumber || 1}</div>
            <div class="home-hero-club">${club.name}</div>
          </div>
          <div class="home-hero-season">MD ${season.currentMatchday}/${season.totalMatchdays || 38}</div>
        </div>
        <div class="home-stats-row">
          <div class="home-stat">
            <div class="home-stat-value gold">${formatMoney(club.balance)}</div>
            <div class="home-stat-label">Balance</div>
          </div>
          <div class="home-stat">
            <div class="home-stat-value green">${standing ? standing.position + '/' + totalClubs : '-'}</div>
            <div class="home-stat-label">Position</div>
          </div>
          <div class="home-stat">
            <div class="home-stat-value white">${avgOvr}</div>
            <div class="home-stat-label">Squad OVR</div>
          </div>
        </div>
      </div>

      ${nextMatchHtml}

      <div class="season-progress">
        <div class="season-progress-label">
          <span>Season Progress</span>
          <span>MD ${season.currentMatchday}/${season.totalMatchdays || 38}</span>
        </div>
        <div class="season-progress-bar">
          <div class="season-progress-fill" style="width:${Math.round((season.currentMatchday / (season.totalMatchdays || 38)) * 100)}%"></div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="quick-action-btn" onclick="switchSection('squad');setTimeout(()=>switchSubTab('formation'),50)">
          <span class="quick-action-icon">&#9881;</span>
          <span class="quick-action-label">Tactics</span>
        </button>
        <button class="quick-action-btn" onclick="switchSection('transfers')">
          <span class="quick-action-icon">&#8644;</span>
          <span class="quick-action-label">Transfers</span>
        </button>
        <button class="quick-action-btn" onclick="switchSection('club');setTimeout(()=>switchSubTab('training'),50)">
          <span class="quick-action-icon">&#9650;</span>
          <span class="quick-action-label">Training</span>
        </button>
        <button class="quick-action-btn" onclick="switchSection('club');setTimeout(()=>switchSubTab('finances'),50)">
          <span class="quick-action-icon">&#36;</span>
          <span class="quick-action-label">Finances</span>
        </button>
      </div>

      ${lastResultHtml}

      <div class="card">
        <div class="card-header">
          <span class="card-title">League Standings</span>
          <button class="btn btn-ghost btn-xs" onclick="switchSection('matches');setTimeout(()=>switchSubTab('league'),50)">View All</button>
        </div>
        <div id="home-league-preview">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    // Load league preview
    loadLeaguePreview();

    // Start polling for match updates
    startMatchPolling();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function loadLeaguePreview() {
  try {
    const data = await api.get('/league');
    const el = document.getElementById('home-league-preview');
    if (!el) return;

    const top5 = data.standings.slice(0, 5);
    const userStanding = data.standings.find(s => s.clubId === state.club?.id);

    let rows = top5.map(s => {
      const isUser = s.clubId === state.club?.id;
      return `
        <tr class="${isUser ? 'highlight' : ''}">
          <td style="font-weight:700">${s.position}</td>
          <td style="color:var(--text-primary);font-weight:${isUser ? '700' : '500'}">${s.name}</td>
          <td>${s.played}</td>
          <td>${s.won}</td>
          <td>${s.drawn}</td>
          <td>${s.lost}</td>
          <td style="font-weight:800;color:var(--gold)">${s.points}</td>
        </tr>
      `;
    }).join('');

    // If user is not in top 5, add them
    if (userStanding && userStanding.position > 5) {
      rows += `
        <tr><td colspan="7" style="padding:4px;color:var(--text-muted);font-size:10px">...</td></tr>
        <tr class="highlight">
          <td style="font-weight:700">${userStanding.position}</td>
          <td style="color:var(--text-primary);font-weight:700">${userStanding.name}</td>
          <td>${userStanding.played}</td>
          <td>${userStanding.won}</td>
          <td>${userStanding.drawn}</td>
          <td>${userStanding.lost}</td>
          <td style="font-weight:800;color:var(--gold)">${userStanding.points}</td>
        </tr>
      `;
    }

    el.innerHTML = `
      <div class="table-container" style="border:none">
        <table>
          <thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) { /* silent */ }
}

// ─── SQUAD SECTION ───────────────────────────────────────────────────────────
async function renderSquadSection(container) {
  const tab = state.currentSubTab || 'overview';

  if (tab === 'overview') return renderSquadOverview(container);
  if (tab === 'formation') return renderFormation(container);
  if (tab === 'list') return renderSquadList(container);
  if (tab === 'injuries') return renderInjuries(container);
}

async function renderSquadOverview(container) {
  try {
    const data = await api.get('/squad?sort=ovr&order=desc');
    const players = data.players;
    const avgOvr = players.length > 0 ? Math.round(players.reduce((s, p) => s + p.ovr, 0) / players.length) : 0;
    const topPlayer = players[0];
    const avgAge = players.length > 0 ? (players.reduce((s, p) => s + p.age, 0) / players.length).toFixed(1) : 0;

    const positionCounts = {};
    players.forEach(p => { positionCounts[p.position] = (positionCounts[p.position] || 0) + 1; });

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Squad</div>
          <div class="section-subtitle">${players.length} players</div>
        </div>
      </div>

      <div class="squad-overview">
        <div class="squad-stat">
          <div class="squad-stat-value">${avgOvr}</div>
          <div class="squad-stat-label">Avg OVR</div>
        </div>
        <div class="squad-stat">
          <div class="squad-stat-value">${avgAge}</div>
          <div class="squad-stat-label">Avg Age</div>
        </div>
        <div class="squad-stat">
          <div class="squad-stat-value">${players.length}</div>
          <div class="squad-stat-label">Players</div>
        </div>
      </div>

      ${topPlayer ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Star Player</span>
          </div>
          <div class="player-card" onclick="showPlayerProfile('${topPlayer.id}')">
            <img class="player-card-avatar" src="${playerAvatarUrl(topPlayer)}" alt="">
            <div class="player-card-info">
              <div class="player-card-name">${topPlayer.firstName} ${topPlayer.lastName}</div>
              <div class="player-card-meta">
                <span class="pos-badge pos-${topPlayer.position}">${topPlayer.position}</span>
                <span class="player-card-age">Age ${topPlayer.age}</span>
              </div>
            </div>
            <div class="player-card-stats">
              <span class="ovr-badge ${ovrClass(topPlayer.ovr)}">${topPlayer.ovr}</span>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="card">
        <div class="card-header">
          <span class="card-title">Squad Breakdown</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          ${['GK','CB','LB','RB','CDM','CM','CAM','LW','RW','ST'].map(pos => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-input);border-radius:6px">
              <span class="pos-badge pos-${pos}">${pos}</span>
              <span style="font-weight:700;font-size:13px">${positionCounts[pos] || 0}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Top Players</span>
          <button class="btn btn-ghost btn-xs" onclick="switchSubTab('list')">View All</button>
        </div>
        ${players.slice(0, 5).map(p => `
          <div class="player-card" onclick="showPlayerProfile('${p.id}')">
            <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
            <div class="player-card-info">
              <div class="player-card-name">${p.firstName} ${p.lastName}</div>
              <div class="player-card-meta">
                <span class="pos-badge pos-${p.position}">${p.position}</span>
                <span class="player-card-age">Age ${p.age}</span>
                <span style="font-size:11px;color:var(--text-muted)">${p.fitness}% fit</span>
              </div>
            </div>
            <div class="player-card-stats">
              <span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Formations ──────────────────────────────────────────────────────────────
const FORMATIONS = {
  '4-4-2': [
    {role:'GK',x:50,y:90},{role:'LB',x:15,y:72},{role:'CB',x:37,y:76},{role:'CB',x:63,y:76},{role:'RB',x:85,y:72},
    {role:'LM',x:15,y:46},{role:'CM',x:37,y:52},{role:'CM',x:63,y:52},{role:'RM',x:85,y:46},
    {role:'ST',x:37,y:20},{role:'ST',x:63,y:20}
  ],
  '4-3-3': [
    {role:'GK',x:50,y:90},{role:'LB',x:15,y:72},{role:'CB',x:37,y:76},{role:'CB',x:63,y:76},{role:'RB',x:85,y:72},
    {role:'CM',x:30,y:50},{role:'CDM',x:50,y:56},{role:'CM',x:70,y:50},
    {role:'LW',x:20,y:22},{role:'ST',x:50,y:16},{role:'RW',x:80,y:22}
  ],
  '3-5-2': [
    {role:'GK',x:50,y:90},{role:'CB',x:25,y:76},{role:'CB',x:50,y:80},{role:'CB',x:75,y:76},
    {role:'LWB',x:10,y:50},{role:'CM',x:35,y:54},{role:'CM',x:65,y:54},{role:'RWB',x:90,y:50},
    {role:'CAM',x:50,y:32},{role:'ST',x:37,y:16},{role:'ST',x:63,y:16}
  ],
  '4-2-3-1': [
    {role:'GK',x:50,y:90},{role:'LB',x:15,y:72},{role:'CB',x:37,y:76},{role:'CB',x:63,y:76},{role:'RB',x:85,y:72},
    {role:'CDM',x:37,y:56},{role:'CDM',x:63,y:56},
    {role:'LW',x:20,y:34},{role:'CAM',x:50,y:34},{role:'RW',x:80,y:34},
    {role:'ST',x:50,y:16}
  ],
  '5-3-2': [
    {role:'GK',x:50,y:90},{role:'CB',x:30,y:78},{role:'CB',x:50,y:80},{role:'CB',x:70,y:78},
    {role:'LWB',x:10,y:68},{role:'RWB',x:90,y:68},
    {role:'CM',x:30,y:50},{role:'CM',x:50,y:52},{role:'CM',x:70,y:50},
    {role:'ST',x:37,y:18},{role:'ST',x:63,y:18}
  ],
  '3-4-3': [
    {role:'GK',x:50,y:90},{role:'CB',x:25,y:76},{role:'CB',x:50,y:80},{role:'CB',x:75,y:76},
    {role:'LM',x:12,y:48},{role:'CM',x:37,y:52},{role:'CM',x:63,y:52},{role:'RM',x:88,y:48},
    {role:'LW',x:22,y:20},{role:'ST',x:50,y:14},{role:'RW',x:78,y:20}
  ],
  '4-1-4-1': [
    {role:'GK',x:50,y:90},{role:'LB',x:15,y:72},{role:'CB',x:37,y:76},{role:'CB',x:63,y:76},{role:'RB',x:85,y:72},
    {role:'CDM',x:50,y:60},
    {role:'LM',x:15,y:40},{role:'CM',x:37,y:44},{role:'CM',x:63,y:44},{role:'RM',x:85,y:40},
    {role:'ST',x:50,y:16}
  ],
};

async function renderFormation(container) {
  try {
    const data = await api.get('/tactics');
    const t = data.tactics;
    state.tacticsState = {
      formation: t.formation || '4-4-2',
      mentality: t.mentality || 'balanced',
      pressing: t.pressing || 'normal',
      tempo: t.tempo || 'normal',
      passingStyle: t.passingStyle || 'mixed',
      captainId: t.captainId || null,
      lineup: t.lineup || {},
      players: data.players,
      selectedSlot: null,
    };
    drawFormation(container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function drawFormation(container) {
  const ts = state.tacticsState;
  const slots = FORMATIONS[ts.formation];
  const assignedIds = Object.values(ts.lineup);
  const unassigned = ts.players.filter(p => !assignedIds.includes(p.id));

  const formationBtns = Object.keys(FORMATIONS).map(f =>
    `<button class="formation-btn ${ts.formation === f ? 'active' : ''}" onclick="selectFormation('${f}')">${f}</button>`
  ).join('');

  const pitchSlots = slots.map((slot, i) => {
    const playerId = ts.lineup[i];
    const player = ts.players.find(p => p.id === playerId);
    const isSelected = ts.selectedSlot === i;
    return `
      <div class="pitch-player ${isSelected ? 'selected' : ''} ${player ? 'filled' : 'empty'}"
           style="left:${slot.x}%;top:${slot.y}%"
           onclick="selectSlot(${i})">
        <div class="pitch-player-circle">
          ${player ? `<img class="pitch-player-avatar" src="${playerAvatarUrl(player)}" alt="">` : `<span class="pitch-player-plus">+</span>`}
        </div>
        <div class="pitch-player-name">
          ${player ? player.lastName : slot.role}
        </div>
        <div class="pitch-player-role">${slot.role}</div>
      </div>
    `;
  }).join('');

  const benchHtml = unassigned.slice(0, 8).map(p => `
    <div class="player-card" style="padding:8px;margin-bottom:4px" onclick="showPlayerProfile('${p.id}')">
      <img class="player-card-avatar" style="width:32px;height:32px" src="${playerAvatarUrl(p)}" alt="">
      <div class="player-card-info">
        <div class="player-card-name" style="font-size:12px">${p.firstName} ${p.lastName}</div>
        <div class="player-card-meta">
          <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
        </div>
      </div>
      <span class="ovr-badge ${ovrClass(p.ovr)}" style="width:30px;height:24px;font-size:11px">${p.ovr}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Formation</div>
        <div class="section-subtitle">${ts.formation} &middot; ${Object.keys(ts.lineup).length}/11 set</div>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-ghost btn-sm" onclick="autoFillLineup()">Auto</button>
        <button class="btn btn-primary btn-sm" onclick="saveTactics()">Save</button>
      </div>
    </div>

    <div class="formation-selector mb-12">${formationBtns}</div>

    <div class="pitch-wrapper">
      <div class="pitch">
        <div class="pitch-markings">
          <div class="pitch-center-circle"></div>
          <div class="pitch-center-line"></div>
          <div class="pitch-box-top"></div>
          <div class="pitch-box-bottom"></div>
          <div class="pitch-goal-top"></div>
          <div class="pitch-goal-bottom"></div>
        </div>
        ${pitchSlots}
      </div>
    </div>

    ${ts.selectedSlot !== null ? renderSlotPicker() : ''}

    <div class="card mt-12">
      <div class="card-header">
        <span class="card-title">Substitutes</span>
        <span class="card-subtitle">${unassigned.length} available</span>
      </div>
      ${benchHtml || '<p class="text-muted text-sm">All players assigned</p>'}
    </div>
  `;
}

function renderSlotPicker() {
  const ts = state.tacticsState;
  const slot = FORMATIONS[ts.formation][ts.selectedSlot];
  const assignedIds = Object.values(ts.lineup);
  const currentId = ts.lineup[ts.selectedSlot];

  const candidates = ts.players
    .filter(p => p.id !== currentId || !currentId)
    .filter(p => !assignedIds.includes(p.id) || p.id === currentId)
    .sort((a, b) => {
      const aMatch = a.position === slot.role ? 0 : 1;
      const bMatch = b.position === slot.role ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return b.ovr - a.ovr;
    });

  const rows = candidates.slice(0, 10).map(p => `
    <div class="player-card" style="padding:8px;margin-bottom:4px" onclick="assignPlayerToSlot('${p.id}')">
      <img class="player-card-avatar" style="width:32px;height:32px" src="${playerAvatarUrl(p)}" alt="">
      <div class="player-card-info">
        <div class="player-card-name" style="font-size:12px">${p.firstName} ${p.lastName}</div>
        <div class="player-card-meta">
          <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
        </div>
      </div>
      <span class="ovr-badge ${ovrClass(p.ovr)}" style="width:30px;height:24px;font-size:11px">${p.ovr}</span>
    </div>
  `).join('');

  return `
    <div class="card mt-12" style="border-color:var(--gold-dim)">
      <div class="card-header">
        <span class="card-title">Assign ${slot.role}</span>
        <button class="btn btn-ghost btn-xs" onclick="clearSlot()">Clear</button>
      </div>
      ${rows}
    </div>
  `;
}

function selectFormation(f) {
  state.tacticsState.formation = f;
  state.tacticsState.lineup = {};
  state.tacticsState.selectedSlot = null;
  drawFormation(document.getElementById('main-content'));
}

function selectSlot(i) {
  state.tacticsState.selectedSlot = state.tacticsState.selectedSlot === i ? null : i;
  drawFormation(document.getElementById('main-content'));
}

function clearSlot() {
  delete state.tacticsState.lineup[state.tacticsState.selectedSlot];
  state.tacticsState.selectedSlot = null;
  drawFormation(document.getElementById('main-content'));
}

function assignPlayerToSlot(playerId) {
  const prevSlot = Object.entries(state.tacticsState.lineup).find(([k, v]) => v === playerId);
  if (prevSlot) delete state.tacticsState.lineup[prevSlot[0]];
  state.tacticsState.lineup[state.tacticsState.selectedSlot] = playerId;
  state.tacticsState.selectedSlot = null;
  drawFormation(document.getElementById('main-content'));
}

function autoFillLineup() {
  const ts = state.tacticsState;
  const slots = FORMATIONS[ts.formation];
  const lineup = {};
  const used = new Set();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const candidates = ts.players
      .filter(p => !used.has(p.id))
      .sort((a, b) => {
        const aMatch = a.position === slot.role ? 0 : 1;
        const bMatch = b.position === slot.role ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return b.ovr - a.ovr;
      });
    if (candidates.length > 0) {
      lineup[i] = candidates[0].id;
      used.add(candidates[0].id);
    }
  }
  ts.lineup = lineup;
  ts.selectedSlot = null;
  drawFormation(document.getElementById('main-content'));
}

async function saveTactics() {
  try {
    await api.post('/tactics', {
      formation: state.tacticsState.formation,
      mentality: state.tacticsState.mentality,
      pressing: state.tacticsState.pressing,
      tempo: state.tacticsState.tempo,
      passingStyle: state.tacticsState.passingStyle,
      captainId: state.tacticsState.captainId,
      lineup: state.tacticsState.lineup,
    });
    showToast('Tactics saved!');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderSquadList(container) {
  try {
    const params = new URLSearchParams({ sort: state.squadSort.col, order: state.squadSort.order });
    if (state.squadFilter) params.set('position', state.squadFilter);
    const data = await api.get(`/squad?${params}`);

    const positions = ['', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
    const posOptions = positions.map(p => `<option value="${p}" ${state.squadFilter === p ? 'selected' : ''}>${p || 'All Positions'}</option>`).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">All Players</div>
          <div class="section-subtitle">${data.players.length} players</div>
        </div>
      </div>

      <div class="filter-bar">
        <select onchange="filterSquad(this.value)">${posOptions}</select>
      </div>

      ${data.players.map(p => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}">${p.position}</span>
              <span class="player-card-age">Age ${p.age}</span>
              <span style="font-size:11px">${p.fitness}%
                <span class="bar-container"><span class="bar-fill ${barColor(p.fitness)}" style="width:${p.fitness}%"></span></span>
              </span>
            </div>
          </div>
          <div class="player-card-stats">
            <span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function filterSquad(pos) {
  state.squadFilter = pos;
  renderSquadList(document.getElementById('main-content'));
}

// ─── Player Detail ───────────────────────────────────────────────────────────
async function showPlayerDetail(playerId) {
  try {
    const data = await api.get(`/squad/${playerId}`);
    const p = data.player;

    const attrs = [
      { label: 'Pace', value: p.pace },
      { label: 'Shooting', value: p.shooting },
      { label: 'Passing', value: p.passing },
      { label: 'Defending', value: p.defending },
      { label: 'Physical', value: p.physical },
      { label: 'Goalkeeping', value: p.goalkeeping },
    ];

    const attrHtml = attrs.map(a => `
      <div class="attr-row">
        <span class="attr-label">${a.label}</span>
        <span class="attr-value" style="color:${a.value >= 75 ? 'var(--green-bright)' : a.value >= 55 ? 'var(--gold)' : 'var(--red)'}">${a.value}</span>
      </div>
    `).join('');

    openModal('Player Profile', `
      <div class="player-detail-header">
        <img class="player-detail-avatar" src="${playerAvatarUrl(p)}" alt="">
        <div>
          <div class="player-detail-name">${p.firstName} ${p.lastName}</div>
          <div class="player-detail-info">
            <span class="pos-badge pos-${p.position}">${p.position}</span>
            &middot; Age ${p.age} &middot; Pot ${p.potential}
          </div>
        </div>
        <div class="player-detail-ovr ${ovrClass(p.ovr)}">${p.ovr}</div>
      </div>
      <div class="player-attrs">${attrHtml}</div>
      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div class="attr-row"><span class="attr-label">Value</span><span class="attr-value text-gold">${formatMoney(p.value)}</span></div>
        <div class="attr-row"><span class="attr-label">Salary</span><span class="attr-value">${formatMoney(p.salary)}/w</span></div>
        <div class="attr-row"><span class="attr-label">Fitness</span><span class="attr-value">${p.fitness}%</span></div>
        <div class="attr-row"><span class="attr-label">Morale</span><span class="attr-value">${p.morale}%</span></div>
      </div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn btn-danger btn-sm" onclick="sellPlayer(${p.id}, '${p.firstName} ${p.lastName}')">List for Sale</button>
      </div>
    `);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function sellPlayer(playerId, name) {
  if (!confirm(`List ${name} for sale?`)) return;
  try {
    const data = await api.post(`/transfers/sell/${playerId}`);
    showToast(data.message);
    closeModal();
    // Refresh current view
    const main = document.getElementById('main-content');
    if (state.currentSection === 'squad') {
      renderSquadSection(main);
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── MATCHES SECTION ─────────────────────────────────────────────────────────
let matchPollTimer = null;
let lastSimulatedMatchday = 0;
let lastMatchResult = null;

async function renderMatchesSection(container) {
  const tab = state.currentSubTab || 'next';
  if (tab === 'next') return renderNextMatch(container);
  if (tab === 'results') return renderMatchResults(container);
  if (tab === 'league') return renderLeagueTable(container);
  if (tab === 'stats') return renderLeaderboards(container);
}

function startMatchPolling() {
  stopMatchPolling();
  matchPollTimer = setInterval(pollMatchStatus, 3000);
}

function stopMatchPolling() {
  if (matchPollTimer) { clearInterval(matchPollTimer); matchPollTimer = null; }
}

async function pollMatchStatus() {
  try {
    const data = await api.get('/matches/status');
    if (data.status === 'finished') {
      stopMatchPolling();
      return;
    }

    // Detect new simulation results
    if (data.allSimulated && data.currentMatchday > lastSimulatedMatchday) {
      lastSimulatedMatchday = data.currentMatchday;
      if (data.userMatch && data.userMatch.simulated) {
        const r = data.userMatch;
        const isHome = r.homeTeamId === state.club?.id;
        const userGoals = isHome ? r.homeGoals : r.awayGoals;
        const oppGoals = isHome ? r.awayGoals : r.homeGoals;

        // Show result notification
        const result = userGoals > oppGoals ? 'Victory!' : userGoals < oppGoals ? 'Defeat' : 'Draw';
        showToast(`${result} ${r.homeName} ${r.homeGoals}-${r.awayGoals} ${r.awayName}`, userGoals >= oppGoals ? 'success' : 'error');

        // Store for match viewer
        lastMatchResult = data.userMatch;
      }
      // Refresh the current view
      const main = document.getElementById('main-content');
      if (state.currentSection === 'matches' || state.currentSection === 'home') {
        const render = state.currentSection === 'home' ? renderHome : renderNextMatch;
        render(main);
      }
    }
  } catch (e) {
    // Silent fail for polling
  }
}

async function renderNextMatch(container) {
  try {
    const data = await api.get('/matches/current');

    const userMatch = data.matches?.find(m => m.homeTeamId === state.club?.id || m.awayTeamId === state.club?.id);
    const isHome = userMatch?.homeTeamId === state.club?.id;
    const oppName = userMatch ? (isHome ? (userMatch.awayName || 'Away') : (userMatch.homeName || 'Home')) : '';

    const otherMatches = data.matches?.filter(m =>
      m.homeTeamId !== state.club?.id && m.awayTeamId !== state.club?.id
    ) || [];

    // Start polling for auto-simulation
    startMatchPolling();

    const homeName = userMatch ? (userMatch.homeName || 'Home') : '';
    const awayName = userMatch ? (userMatch.awayName || 'Away') : '';

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Match Center</div>
          <div class="section-subtitle">Matchday ${data.matchday}/${data.totalMatchdays || '?'} &middot; ${data.status}</div>
        </div>
      </div>

      ${userMatch ? `
        <div class="next-match-card">
          <div class="next-match-label">
            <span class="live-dot"></span>
            ${userMatch.simulated ? 'Result' : 'Upcoming'} &middot; ${isHome ? 'Home' : 'Away'}
          </div>
          <div class="next-match-teams">
            <div class="next-match-team">
              <div class="next-match-team-badge" style="background:linear-gradient(135deg, var(--green), var(--green-light))">&#9917;</div>
              <div class="next-match-team-name">${homeName}</div>
            </div>
            <div class="next-match-vs">${userMatch.simulated ? '' : 'VS'}</div>
            <div class="next-match-team">
              <div class="next-match-team-badge" style="background:linear-gradient(135deg, #4a9eff, #2a6acc)">&#9917;</div>
              <div class="next-match-team-name">${awayName}</div>
            </div>
          </div>
          ${userMatch.simulated ? `
            <div style="text-align:center;margin:8px 0">
              <span style="font-size:28px;font-weight:900;color:var(--gold);letter-spacing:3px">${userMatch.homeGoals} - ${userMatch.awayGoals}</span>
            </div>
            <div class="next-match-action">
              <button class="btn btn-gold" onclick="showMatchReport('${userMatch.id}')">View Report</button>
            </div>
          ` : `
            <div class="autoplay-notice">
              <div class="spinner"></div>
              <span>Match will be played automatically...</span>
            </div>
          `}
        </div>
      ` : '<div class="empty-state"><p>No match scheduled for this matchday</p></div>'}

      <div class="card">
        <div class="card-header">
          <span class="card-title">Other Fixtures</span>
          <span class="card-subtitle">MD ${data.matchday}</span>
        </div>
        ${otherMatches.length > 0 ? otherMatches.map(m => `
          <div class="match-card-result" ${m.simulated ? `onclick="showMatchReport('${m.id}')"` : ''}>
            <div class="match-result-team">
              <span class="match-result-team-name">${m.homeName || 'Home'}</span>
            </div>
            <div class="match-result-score ${m.simulated ? '' : 'pending'}">
              ${m.simulated ? `${m.homeGoals} - ${m.awayGoals}` : 'vs'}
            </div>
            <div class="match-result-team away">
              <span class="match-result-team-name">${m.awayName || 'Away'}</span>
            </div>
          </div>
        `).join('') : '<p class="text-muted text-sm">No other fixtures</p>'}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function renderMatchResults(container) {
  try {
    const data = await api.get('/matches/history');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Results</div>
          <div class="section-subtitle">${data.matches.length} matches played</div>
        </div>
      </div>

      ${data.matches.length === 0 ? '<div class="empty-state"><p>No matches played yet</p></div>' : ''}

      ${data.matches.map(m => {
        const isHome = m.homeTeamId === state.club?.id;
        const userGoals = isHome ? m.homeGoals : m.awayGoals;
        const oppGoals = isHome ? m.awayGoals : m.homeGoals;
        const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';
        return `
          <div class="match-card-result" onclick="showMatchReport('${m.id}')">
            <div class="match-result-team">
              <span class="text-muted text-sm" style="min-width:28px">MD${m.matchday}</span>
              <span class="match-result-team-name">${m.homeName || 'Home'}</span>
            </div>
            <div class="match-result-score">${m.homeGoals} - ${m.awayGoals}</div>
            <div class="match-result-team away">
              <span class="match-result-team-name">${m.awayName || 'Away'}</span>
              <span class="result-badge result-${result}">${result}</span>
            </div>
          </div>
        `;
      }).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function renderLeagueTable(container) {
  try {
    const data = await api.get('/league');

    const rows = data.standings.map(s => {
      const isUser = s.clubId === state.club?.id;
      const isRelegation = s.position > 17;
      return `
        <tr class="${isUser ? 'highlight' : ''} ${isRelegation ? 'relegation' : ''}">
          <td style="font-weight:700">${s.position}</td>
          <td style="color:var(--text-primary);font-weight:${isUser ? '700' : '500'};cursor:pointer" onclick="showClubProfile('${s.clubId}')">${s.name}</td>
          <td>${s.played}</td>
          <td>${s.won}</td>
          <td>${s.drawn}</td>
          <td>${s.lost}</td>
          <td>${s.goalsFor}</td>
          <td>${s.goalsAgainst}</td>
          <td>${s.goalDifference > 0 ? '+' : ''}${s.goalDifference}</td>
          <td style="font-weight:800;color:var(--gold)">${s.points}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">League Table</div>
          <div class="section-subtitle">Matchday ${data.season.currentMatchday} of ${data.season.totalMatchdays || 38}</div>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="flex gap-12 mt-12 text-sm text-muted">
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(26,122,90,0.3);border-radius:2px;vertical-align:middle;margin-right:4px"></span> Your club</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(224,85,85,0.2);border-radius:2px;vertical-align:middle;margin-right:4px"></span> Relegation</span>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Match Simulation (auto - viewer only) ───────────────────────────────────
async function simulateMatch() {
  // Matches are simulated automatically. This just opens the viewer for the latest result.
  if (lastMatchResult) {
    try {
      const report = await api.get(`/matches/report/${lastMatchResult.id}`);
      openMatchViewer({
        homeName: report.match.homeName || 'Home',
        awayName: report.match.awayName || 'Away',
        homeFormation: '4-4-2',
        awayFormation: '4-4-2',
      });
      feedMatchEvents({
        events: report.events || [],
        homeName: report.match.homeName || 'Home',
        awayName: report.match.awayName || 'Away',
      });
      state.matchViewerCloseCallback = () => {
        renderNextMatch(document.getElementById('main-content'));
      };
    } catch (e) {
      showToast(e.message, 'error');
    }
  } else {
    showToast('Match will be played automatically', 'info');
  }
}

async function advanceMatchday() {
  try {
    const data = await api.post('/matches/advance');
    if (data.finished) {
      showToast('Season finished! Check the league table.', 'info');
    } else {
      showToast(`Advanced to matchday ${data.matchday}`);
    }
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateTopBar();
    renderNextMatch(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Match Viewer ────────────────────────────────────────────────────────────
function openMatchViewer(matchInfo) {
  const overlay = document.getElementById('match-viewer-overlay');
  overlay.style.display = 'flex';
  document.getElementById('mv-home-name').textContent = matchInfo.homeName;
  document.getElementById('mv-away-name').textContent = matchInfo.awayName;
  const homeBadge = document.getElementById('mv-home-badge');
  const awayBadge = document.getElementById('mv-away-badge');
  homeBadge.style.background = 'linear-gradient(135deg, #22a06b, #1a7a5a)';
  awayBadge.style.background = 'linear-gradient(135deg, #4a9eff, #2a6acc)';
  document.getElementById('mv-home-score').textContent = '0';
  document.getElementById('mv-away-score').textContent = '0';
  document.getElementById('mv-commentary-list').innerHTML = '';
  const canvas = document.getElementById('mv-canvas');
  MatchViewer.init(canvas, { events: [], homeName: matchInfo.homeName, awayName: matchInfo.awayName }, matchInfo.homeFormation, matchInfo.awayFormation);
  MatchViewer.start();
}

function feedMatchEvents(matchData) {
  const mvState = MatchViewer.getState();
  if (!mvState) return;
  const canvas = document.getElementById('mv-canvas');
  MatchViewer.stop();
  MatchViewer.init(canvas, matchData, mvState.homeForm, mvState.awayForm);
  MatchViewer.start();
}

function closeMatchViewer() {
  MatchViewer.stop();
  document.getElementById('match-viewer-overlay').style.display = 'none';
  if (state.matchViewerCloseCallback) {
    state.matchViewerCloseCallback();
    state.matchViewerCloseCallback = null;
  }
}

function mvTogglePause() {
  const paused = MatchViewer.togglePause();
  const btn = document.getElementById('mv-pause-btn');
  btn.innerHTML = paused ? '&#9654; Play' : '&#9646;&#9646; Pause';
}

function mvSetSpeed(speed) {
  MatchViewer.setSpeed(speed);
  document.querySelectorAll('.mv-speed').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.speed) === speed);
  });
}

async function showMatchReport(matchId) {
  try {
    const data = await api.get(`/matches/report/${matchId}`);
    const m = data.match;
    const homeName = m.homeName || 'Home';
    const awayName = m.awayName || 'Away';

    const eventsHtml = data.events.map(e => {
      const icon = e.type === 'goal' ? '&#9917;' : e.type === 'yellow' ? '&#9888;' : '&#10060;';
      return `<div class="commentary-item ${e.type === 'goal' ? 'commentary-goal' : ''}">
        <span class="commentary-min">${e.minute}'</span>
        <span>${icon}</span>
        <span class="commentary-text">${e.player}${e.assist ? ` (assist: ${e.assist})` : ''}</span>
      </div>`;
    }).join('');

    openModal('Match Report', `
      <div style="text-align:center;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:center;gap:16px">
          <span style="font-weight:700;font-size:14px">${homeName}</span>
          <span style="font-size:28px;font-weight:900;color:var(--gold)">${m.homeGoals} - ${m.awayGoals}</span>
          <span style="font-weight:700;font-size:14px">${awayName}</span>
        </div>
        <div class="text-muted text-sm mt-8">Matchday ${m.matchday}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:4px">
          <span class="attr-label">Possession</span>
          <span class="attr-value">${data.stats.home.possession}% - ${data.stats.away.possession}%</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:4px">
          <span class="attr-label">Shots</span>
          <span class="attr-value">${data.stats.home.shots} - ${data.stats.away.shots}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:4px">
          <span class="attr-label">Corners</span>
          <span class="attr-value">${data.stats.home.corners} - ${data.stats.away.corners}</span>
        </div>
      </div>
      <div class="card-title mb-8">Events</div>
      ${eventsHtml || '<p class="text-muted text-sm">No events</p>'}
    `);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── TRANSFERS SECTION ───────────────────────────────────────────────────────
async function renderTransfersSection(container) {
  const tab = state.currentSubTab || 'market';
  if (tab === 'market') return renderTransferMarket(container);
  if (tab === 'listed') return renderListedPlayers(container);
  if (tab === 'history') return renderTransferHistory(container);
}

async function renderTransferMarket(container) {
  try {
    const params = new URLSearchParams({ sort: state.transferSort.col, order: state.transferSort.order });
    if (state.transferFilter) params.set('position', state.transferFilter);
    const data = await api.get(`/transfers/market?${params}`);

    const positions = ['', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
    const posOptions = positions.map(p => `<option value="${p}" ${state.transferFilter === p ? 'selected' : ''}>${p || 'All Positions'}</option>`).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Transfer Market</div>
          <div class="section-subtitle">${data.players.length} available &middot; Budget: <span class="money">${formatMoney(data.budget)}</span></div>
        </div>
      </div>

      <div class="filter-bar">
        <select onchange="filterTransfers(this.value)">${posOptions}</select>
      </div>

      ${data.players.map(p => `
        <div class="transfer-card">
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="transfer-card-info">
            <div class="transfer-card-name">${p.firstName} ${p.lastName}</div>
            <div class="transfer-card-details">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span>Age ${p.age}</span>
              <span>OVR ${p.ovr}</span>
              <span>Pot ${p.potential}</span>
            </div>
          </div>
          <div class="transfer-card-price">
            <div class="transfer-price">${formatMoney(p.askingPrice)}</div>
            <button class="btn btn-primary btn-xs mt-8" onclick="buyPlayer(${p.id}, '${p.firstName} ${p.lastName}', ${p.askingPrice})"
              ${p.askingPrice > data.budget ? 'disabled' : ''}>
              Sign
            </button>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function filterTransfers(pos) {
  state.transferFilter = pos;
  renderTransferMarket(document.getElementById('main-content'));
}

async function buyPlayer(playerId, name, price) {
  if (!confirm(`Sign ${name} for ${formatMoney(price)}?`)) return;
  try {
    const data = await api.post(`/transfers/buy/${playerId}`);
    showToast(data.message);
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateTopBar();
    renderTransferMarket(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderListedPlayers(container) {
  try {
    const data = await api.get('/transfers/listed');
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Listed for Sale</div>
          <div class="section-subtitle">${data.players.length} players</div>
        </div>
      </div>
      ${data.players.length === 0 ? '<div class="empty-state"><p>No players listed</p></div>' : ''}
      ${data.players.map(p => `
        <div class="transfer-card">
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="transfer-card-info">
            <div class="transfer-card-name">${p.firstName} ${p.lastName}</div>
            <div class="transfer-card-details">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span>Age ${p.age}</span>
              <span>OVR ${p.ovr}</span>
            </div>
          </div>
          <div class="transfer-card-price">
            <div class="transfer-price">${formatMoney(p.askingPrice)}</div>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function renderTransferHistory(container) {
  try {
    const data = await api.get('/finances');
    const transfers = data.recentTransfers || [];
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Transfer History</div>
          <div class="section-subtitle">${transfers.length} transfers</div>
        </div>
      </div>
      ${transfers.length === 0 ? '<div class="empty-state"><p>No transfers yet</p></div>' : ''}
      ${transfers.map(t => `
        <div class="transfer-card">
          <div class="transfer-card-info">
            <div class="transfer-card-name">${t.firstName} ${t.lastName}</div>
            <div class="transfer-card-details">
              <span>MD${t.matchday}</span>
              <span class="${t.toClubId === state.club?.id ? 'text-green' : 'text-red'}">${t.toClubId === state.club?.id ? 'In' : 'Out'}</span>
            </div>
          </div>
          <div class="transfer-card-price">
            <div class="transfer-price">${formatMoney(t.fee)}</div>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── CLUB SECTION ────────────────────────────────────────────────────────────
async function renderClubSection(container) {
  const tab = state.currentSubTab || 'overview';
  if (tab === 'overview') return renderClubOverview(container);
  if (tab === 'finances') return renderFinances(container);
  if (tab === 'training') return renderTraining(container);
  if (tab === 'tactics') return renderTacticsSettings(container);
  if (tab === 'awards') return renderAwards(container);
}

async function renderClubOverview(container) {
  try {
    const clubData = await api.get('/club');
    const club = clubData.club;
    state.club = club;

    const leagueData = await api.get('/league');
    const standing = leagueData.standings.find(s => s.clubId === club.id);
    const totalClubs = leagueData.standings.length || 20;

    container.innerHTML = `
      <div class="club-overview-card">
        <div class="club-overview-badge">&#9917;</div>
        <div class="club-overview-name">${club.name}</div>
        <div class="club-overview-info">${club.stadium} &middot; ${club.city}</div>
        <div class="club-stats-grid">
          <div class="club-stat-item">
            <div class="club-stat-value text-gold">${formatMoney(club.balance)}</div>
            <div class="club-stat-label">Balance</div>
          </div>
          <div class="club-stat-item">
            <div class="club-stat-value text-green">${formatMoney(club.transferBudget)}</div>
            <div class="club-stat-label">Transfer Budget</div>
          </div>
          <div class="club-stat-item">
            <div class="club-stat-value">${standing ? standing.position + '/' + totalClubs : '-'}</div>
            <div class="club-stat-label">League Pos</div>
          </div>
          <div class="club-stat-item">
            <div class="club-stat-value">${standing ? standing.points : 0}</div>
            <div class="club-stat-label">Points</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Quick Actions</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-ghost" onclick="switchSubTab('training')">&#9650; Training</button>
          <button class="btn btn-ghost" onclick="switchSubTab('tactics')">&#9881; Tactics</button>
          <button class="btn btn-ghost" onclick="switchSubTab('finances')">&#36; Finances</button>
          <button class="btn btn-ghost" onclick="switchSection('squad');setTimeout(()=>switchSubTab('formation'),50)">&#9734; Formation</button>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function renderFinances(container) {
  try {
    const data = await api.get('/finances');
    const wageRows = data.players.slice(0, 10).map(p => `
      <div class="player-card" style="padding:8px;margin-bottom:4px">
        <img class="player-card-avatar" style="width:32px;height:32px" src="${playerAvatarUrl(p)}" alt="">
        <div class="player-card-info">
          <div class="player-card-name" style="font-size:12px">${p.firstName} ${p.lastName}</div>
          <div class="player-card-meta">
            <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
            <span class="player-card-age">Age ${p.age}</span>
          </div>
        </div>
        <div style="text-align:right">
          <div class="money" style="font-size:12px;font-weight:700">${formatMoney(p.salary)}/w</div>
          <div class="text-muted text-sm">${formatMoney(p.value)}</div>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Finances</div>
          <div class="section-subtitle">Club financial overview</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
        <div class="squad-stat">
          <div class="squad-stat-value text-gold">${formatMoney(data.club.balance)}</div>
          <div class="squad-stat-label">Balance</div>
        </div>
        <div class="squad-stat">
          <div class="squad-stat-value text-green">${formatMoney(data.club.transferBudget)}</div>
          <div class="squad-stat-label">Transfer Budget</div>
        </div>
        <div class="squad-stat">
          <div class="squad-stat-value text-red">${formatMoney(data.totalWages)}</div>
          <div class="squad-stat-label">Weekly Wages</div>
        </div>
        <div class="squad-stat">
          <div class="squad-stat-value">${formatMoney(data.totalValue)}</div>
          <div class="squad-stat-label">Squad Value</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Wage Bill</span>
          <span class="card-subtitle">Top earners</span>
        </div>
        ${wageRows}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function renderTraining(container) {
  try {
    const data = await api.get('/training');

    const focusOptions = ['general', 'pace', 'shooting', 'passing', 'defending', 'physical'];
    const focusBtns = focusOptions.map(f =>
      `<button class="formation-btn ${state.trainingFocus === f ? 'active' : ''}" onclick="setTrainingFocus('${f}')">${f.charAt(0).toUpperCase() + f.slice(1)}</button>`
    ).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Training</div>
          <div class="section-subtitle">${data.players.length} players &middot; Focus: ${state.trainingFocus}</div>
        </div>
        <button class="btn btn-gold btn-sm" onclick="trainBatch()">Train All</button>
      </div>

      <div class="formation-selector mb-12">${focusBtns}</div>

      ${data.players.map(p => `
        <div class="player-card">
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}">${p.position}</span>
              <span class="player-card-age">Age ${p.age}</span>
              <span style="font-size:11px">${p.fitness}%
                <span class="bar-container"><span class="bar-fill ${barColor(p.fitness)}" style="width:${p.fitness}%"></span></span>
              </span>
            </div>
          </div>
          <button class="btn btn-primary btn-xs" onclick="trainPlayer(${p.id}, '${p.firstName} ${p.lastName}')"
            ${p.fitness < 30 ? 'disabled' : ''}>
            Train
          </button>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function setTrainingFocus(focus) {
  state.trainingFocus = focus;
  renderTraining(document.getElementById('main-content'));
}

async function trainPlayer(playerId, name) {
  try {
    const data = await api.post(`/training/${playerId}`, { focus: state.trainingFocus });
    const improvements = Object.entries(data.improvements || {}).map(([k, v]) => `${k} +${v - data.player[k]}`).join(', ');
    showToast(`${name} trained! ${improvements || 'No improvement'}`);
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateTopBar();
    renderTraining(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function trainBatch() {
  if (!confirm(`Train entire squad with focus: ${state.trainingFocus}?`)) return;
  try {
    const data = await api.post('/training/batch', { focus: state.trainingFocus });
    showToast(data.message);
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateTopBar();
    renderTraining(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderTacticsSettings(container) {
  try {
    const data = await api.get('/tactics');
    const t = data.tactics;

    const mentalityBtns = ['defensive','counter','balanced','attacking','all-out'].map(m =>
      `<button class="formation-btn ${(t.mentality || 'balanced') === m ? 'active' : ''}" onclick="setTacticSetting('mentality','${m}')">${m.replace('-',' ')}</button>`
    ).join('');

    const pressingBtns = ['low','normal','high','gegenpress'].map(p =>
      `<button class="formation-btn ${(t.pressing || 'normal') === p ? 'active' : ''}" onclick="setTacticSetting('pressing','${p}')">${p === 'gegenpress' ? 'Gegenpress' : p}</button>`
    ).join('');

    const tempoBtns = ['slow','normal','fast','relentless'].map(t =>
      `<button class="formation-btn ${(t.tempo || 'normal') === t ? 'active' : ''}" onclick="setTacticSetting('tempo','${t}')">${t}</button>`
    ).join('');

    const passingBtns = ['short','mixed','long','direct'].map(p =>
      `<button class="formation-btn ${(t.passingStyle || 'mixed') === p ? 'active' : ''}" onclick="setTacticSetting('passingStyle','${p}')">${p}</button>`
    ).join('');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Tactics</div>
          <div class="section-subtitle">Set your game plan</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Mentality</span></div>
        <div class="formation-selector">${mentalityBtns}</div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Pressing</span></div>
        <div class="formation-selector">${pressingBtns}</div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Tempo</span></div>
        <div class="formation-selector">${tempoBtns}</div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Passing Style</span></div>
        <div class="formation-selector">${passingBtns}</div>
      </div>

      <button class="btn btn-primary btn-full mt-12" onclick="switchSection('squad');setTimeout(()=>switchSubTab('formation'),50)">
        Go to Formation &#8594;
      </button>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function setTacticSetting(key, value) {
  try {
    const current = await api.get('/tactics');
    const t = current.tactics;
    await api.post('/tactics', {
      formation: t.formation || '4-4-2',
      mentality: key === 'mentality' ? value : (t.mentality || 'balanced'),
      pressing: key === 'pressing' ? value : (t.pressing || 'normal'),
      tempo: key === 'tempo' ? value : (t.tempo || 'normal'),
      passingStyle: key === 'passingStyle' ? value : (t.passingStyle || 'mixed'),
      captainId: t.captainId || null,
      lineup: t.lineup || {},
    });
    showToast('Tactic updated!');
    renderTacticsSettings(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────
async function showNotifications() {
  try {
    const data = await api.get('/notifications');
    const items = data.notifications.map(n => ({
      icon: n.type === 'match_win' ? '&#9917;' : n.type === 'transfer_in' ? '&#8644;' : '&#128276;',
      label: `<div><div style="font-weight:600">${n.title}</div><div class="text-muted text-sm">${n.message}</div></div>`,
      onclick: '',
    }));

    if (items.length === 0) {
      items.push({ icon: '&#128276;', label: 'No notifications', onclick: '' });
    }

    openActionSheet('Notifications', items);

    // Mark as read
    if (data.unreadCount > 0) {
      await api.post('/notifications/read-all');
      document.getElementById('notif-badge').style.display = 'none';
    }
  } catch (e) {
    showToast('Failed to load notifications', 'error');
  }
}

// ─── Injuries & Medical ──────────────────────────────────────────────────────
async function renderInjuries(container) {
  try {
    const data = await api.get('/injuries');
    const injured = data.injured || [];
    const suspended = data.suspended || [];

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Medical Room</div>
          <div class="section-subtitle">${injured.length} injured &middot; ${suspended.length} suspended</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Injured Players</span>
          <span class="card-subtitle">${injured.length} out</span>
        </div>
        ${injured.length === 0 ? '<p class="text-muted text-sm">No injuries - all fit!</p>' : ''}
        ${injured.map(p => `
          <div class="player-card" onclick="showPlayerProfile('${p.id}')">
            <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
            <div class="player-card-info">
              <div class="player-card-name">${p.firstName} ${p.lastName}</div>
              <div class="player-card-meta">
                <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
                <span class="text-red">${p.injuryType}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div class="text-red fw-700">${p.injuryWeeks}w</div>
              <div class="text-muted text-sm">out</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Suspended Players</span>
          <span class="card-subtitle">${suspended.length} banned</span>
        </div>
        ${suspended.length === 0 ? '<p class="text-muted text-sm">No suspensions</p>' : ''}
        ${suspended.map(p => `
          <div class="player-card" onclick="showPlayerProfile('${p.id}')">
            <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
            <div class="player-card-info">
              <div class="player-card-name">${p.firstName} ${p.lastName}</div>
              <div class="player-card-meta">
                <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
                <span class="text-red">Suspended</span>
              </div>
            </div>
            <div style="text-align:right">
              <div class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Leaderboards / Stats ────────────────────────────────────────────────────
async function renderLeaderboards(container) {
  try {
    const data = await api.get('/leaderboards');
    const statsTab = state.leaderboardTab || 'scorers';

    const tabs = [
      { id: 'scorers', label: 'Top Scorers' },
      { id: 'assists', label: 'Top Assists' },
      { id: 'ovr', label: 'Best Players' },
      { id: 'value', label: 'Most Valuable' },
      { id: 'career', label: 'All-Time' },
    ];

    let listHtml = '';
    let list = [];

    if (statsTab === 'scorers') {
      list = data.topScorers || [];
      listHtml = list.map((p, i) => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <div style="width:24px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text-muted)'}">${i+1}</div>
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted">${p.clubName || 'Unknown'}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="fw-700" style="font-size:16px">${p.goals || 0}</div>
            <div class="text-muted text-sm">goals</div>
          </div>
        </div>
      `).join('');
    } else if (statsTab === 'assists') {
      list = data.topAssists || [];
      listHtml = list.map((p, i) => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <div style="width:24px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text-muted)'}">${i+1}</div>
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted">${p.clubName || 'Unknown'}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="fw-700" style="font-size:16px">${p.assists || 0}</div>
            <div class="text-muted text-sm">assists</div>
          </div>
        </div>
      `).join('');
    } else if (statsTab === 'ovr') {
      list = data.highestOvr || [];
      listHtml = list.map((p, i) => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <div style="width:24px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text-muted)'}">${i+1}</div>
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted">Age ${p.age} &middot; ${p.clubName || 'Unknown'}</span>
            </div>
          </div>
          <div class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</div>
        </div>
      `).join('');
    } else if (statsTab === 'value') {
      list = data.mostValuable || [];
      listHtml = list.map((p, i) => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <div style="width:24px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text-muted)'}">${i+1}</div>
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted">OVR ${p.ovr} &middot; ${p.clubName || 'Unknown'}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="money fw-700">${formatMoney(p.value)}</div>
          </div>
        </div>
      `).join('');
    } else if (statsTab === 'career') {
      list = data.topCareerScorers || [];
      listHtml = list.map((p, i) => `
        <div class="player-card" onclick="showPlayerProfile('${p.id}')">
          <div style="width:24px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text-muted)'}">${i+1}</div>
          <img class="player-card-avatar" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted">${p.clubName || 'Unknown'} &middot; ${p.careerAppearances||0} apps</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="fw-700" style="font-size:16px">${p.careerGoals || 0}</div>
            <div class="text-muted text-sm">career goals</div>
          </div>
        </div>
      `).join('');
    }

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">League Stats</div>
          <div class="section-subtitle">Season leaderboards</div>
        </div>
      </div>

      <div class="tabs">
        ${tabs.map(t => `<button class="tab ${statsTab === t.id ? 'active' : ''}" onclick="state.leaderboardTab='${t.id}';renderLeaderboards(document.getElementById('main-content'))">${t.label}</button>`).join('')}
      </div>

      ${list.length === 0 ? '<div class="empty-state"><p>No data yet</p></div>' : listHtml}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Awards ──────────────────────────────────────────────────────────────────
async function renderAwards(container) {
  try {
    const data = await api.get('/awards');
    const awards = data.awards || [];

    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">Hall of Fame</div>
          <div class="section-subtitle">Season awards &amp; records</div>
        </div>
      </div>

      ${awards.length === 0 ? `
        <div class="empty-state">
          <div class="icon">&#127942;</div>
          <h3>No Awards Yet</h3>
          <p>Complete a season to see awards and champions here.</p>
        </div>
      ` : ''}

      ${awards.map(a => `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Season ${a.seasonNumber}</span>
            <span class="matchday-badge">S${a.seasonNumber}</span>
          </div>

          ${a.champion ? `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:24px">&#127942;</span>
              <div>
                <div class="fw-700">Champion</div>
                <div class="text-muted text-sm">${a.champion.name} &middot; ${a.champion.points} pts</div>
              </div>
            </div>
          ` : ''}

          ${a.topScorer ? `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:20px">&#9917;</span>
              <div>
                <div class="fw-700">Top Scorer</div>
                <div class="text-muted text-sm">${a.topScorer.name} &middot; ${a.topScorer.goals} goals</div>
              </div>
            </div>
          ` : ''}

          ${a.topAssister ? `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:20px">&#127919;</span>
              <div>
                <div class="fw-700">Top Assister</div>
                <div class="text-muted text-sm">${a.topAssister.name} &middot; ${a.topAssister.assists} assists</div>
              </div>
            </div>
          ` : ''}

          ${a.bestYoung ? `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
              <span style="font-size:20px">&#11088;</span>
              <div>
                <div class="fw-700">Best Young Player</div>
                <div class="text-muted text-sm">${a.bestYoung.name} &middot; OVR ${a.bestYoung.ovr} &middot; Age ${a.bestYoung.age}</div>
              </div>
            </div>
          ` : ''}

          ${a.relegated && a.relegated.length > 0 ? `
            <div style="padding:8px 0;border-top:1px solid var(--border)">
              <div class="text-muted text-sm" style="margin-bottom:4px">Relegated:</div>
              ${a.relegated.map(r => `<span class="text-red text-sm">${r.name}</span>`).join(', ')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Player Profile Modal ────────────────────────────────────────────────────
async function showPlayerProfile(playerId) {
  try {
    const data = await api.get(`/players/${playerId}/career`);
    const p = data.player;
    const cs = data.careerStats;
    const history = data.seasonHistory || [];
    const recent = data.recentMatches || [];

    const attrRows = [
      { label: 'Pace', value: p.pace },
      { label: 'Shooting', value: p.shooting },
      { label: 'Passing', value: p.passing },
      { label: 'Defending', value: p.defending },
      { label: 'Physical', value: p.physical },
      { label: 'Goalkeeping', value: p.goalkeeping },
    ];

    openModal(`${p.firstName} ${p.lastName}`, `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <img src="${playerAvatarUrl(p)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover" alt="">
        <div>
          <div style="font-size:18px;font-weight:700">${p.firstName} ${p.lastName}</div>
          <div class="text-muted text-sm">${p.position} &middot; Age ${p.age} &middot; ${data.clubName}</div>
          <div style="margin-top:4px">
            <span class="ovr-badge ${ovrClass(p.ovr)}" style="font-size:16px;padding:4px 12px">${p.ovr}</span>
            <span class="text-muted text-sm" style="margin-left:8px">Pot ${p.potential}</span>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Apps</span>
          <span class="attr-value">${cs.appearances}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Goals</span>
          <span class="attr-value">${cs.goals}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Assists</span>
          <span class="attr-value">${cs.assists}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Value</span>
          <span class="attr-value money">${formatMoney(p.value)}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Fitness</span>
          <span class="attr-value">${p.fitness}%</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Morale</span>
          <span class="attr-value">${p.morale || 70}%</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Form</span>
          <span class="attr-value">${p.form || 70}%</span>
        </div>
      </div>

      ${p.injuryType ? `
        <div style="padding:8px 12px;background:rgba(224,85,85,0.1);border:1px solid var(--red-dim);border-radius:var(--radius);margin-bottom:12px">
          <span class="text-red fw-700">${p.injuryType}</span>
          <span class="text-muted text-sm" style="margin-left:8px">${p.injuryWeeks} weeks out</span>
        </div>
      ` : ''}

      ${p.suspended ? `
        <div style="padding:8px 12px;background:rgba(224,85,85,0.1);border:1px solid var(--red-dim);border-radius:var(--radius);margin-bottom:12px">
          <span class="text-red fw-700">Suspended</span>
        </div>
      ` : ''}

      <div class="card-title mb-8">Attributes</div>
      <div class="player-attrs" style="margin-bottom:16px">
        ${attrRows.map(a => `
          <div class="attr-row">
            <span class="attr-label">${a.label}</span>
            <span class="attr-value" style="color:${a.value>=75?'var(--green-bright)':a.value>=55?'var(--gold)':'var(--red)'}">${a.value}</span>
          </div>
        `).join('')}
      </div>

      ${history.length > 0 ? `
        <div class="card-title mb-8">Season History</div>
        <div style="margin-bottom:16px">
          ${history.map(h => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>S${h.season} &middot; ${h.clubName}</span>
              <span class="text-muted">${h.appearances} apps &middot; ${h.goals} G &middot; ${h.assists} A</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${recent.length > 0 ? `
        <div class="card-title mb-8">Recent Matches</div>
        ${recent.map(m => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span>MD${m.matchday}: ${m.homeName} ${m.homeGoals}-${m.awayGoals} ${m.awayName}</span>
            <span>${m.goals > 0 ? m.goals + 'G ' : ''}${m.assists > 0 ? m.assists + 'A' : '-'}</span>
          </div>
        `).join('')}
      ` : ''}

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Career Apps</span>
          <span class="attr-value">${cs.appearances}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Career Goals</span>
          <span class="attr-value">${cs.goals}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Career Assists</span>
          <span class="attr-value">${cs.assists}</span>
        </div>
      </div>
    `);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Club Profile Modal ──────────────────────────────────────────────────────
async function showClubProfile(clubId) {
  try {
    const data = await api.get(`/clubs/${clubId}`);
    const club = data.club;
    const standing = data.standing;
    const stats = data.stats;
    const formGuide = data.formGuide || [];
    const squad = data.squad || [];
    const recentMatches = data.recentMatches || [];

    openModal(club.name, `
      <div style="text-align:center;margin-bottom:16px">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--green),var(--green-light));display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 8px">&#9917;</div>
        <div style="font-size:18px;font-weight:800">${club.name}</div>
        <div class="text-muted text-sm">${club.stadium} &middot; ${club.city}</div>
        ${standing ? `<div class="matchday-badge" style="margin-top:8px">${standing.position}${getOrdinal(standing.position)} &middot; ${standing.points} pts</div>` : ''}
      </div>

      ${formGuide.length > 0 ? `
        <div style="display:flex;justify-content:center;gap:4px;margin-bottom:12px">
          ${formGuide.map(r => `<span class="form-dot ${r.toLowerCase()}">${r}</span>`).join('')}
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Avg OVR</span>
          <span class="attr-value">${stats.avgOvr}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Squad</span>
          <span class="attr-value">${stats.squadSize}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Avg Age</span>
          <span class="attr-value">${stats.avgAge}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:16px">
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Squad Value</span>
          <span class="attr-value money">${formatMoney(stats.totalValue)}</span>
        </div>
        <div class="attr-row" style="flex-direction:column;align-items:center;gap:2px">
          <span class="attr-label">Injured</span>
          <span class="attr-value ${stats.injuredCount > 0 ? 'text-red' : ''}">${stats.injuredCount}</span>
        </div>
      </div>

      ${standing ? `
        <div class="card-title mb-8">League Record</div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:16px;text-align:center">
          <div><div class="fw-700">${standing.played}</div><div class="text-muted text-sm">P</div></div>
          <div><div class="fw-700 text-green">${standing.won}</div><div class="text-muted text-sm">W</div></div>
          <div><div class="fw-700 text-gold">${standing.drawn}</div><div class="text-muted text-sm">D</div></div>
          <div><div class="fw-700 text-red">${standing.lost}</div><div class="text-muted text-sm">L</div></div>
          <div><div class="fw-700">${standing.goalsFor}-${standing.goalsAgainst}</div><div class="text-muted text-sm">GF-GA</div></div>
          <div><div class="fw-700">${standing.points}</div><div class="text-muted text-sm">Pts</div></div>
        </div>
      ` : ''}

      <div class="card-title mb-8">Top Players</div>
      ${squad.slice(0, 5).map(p => `
        <div class="player-card" style="padding:8px" onclick="closeModal();setTimeout(()=>showPlayerProfile('${p.id}'),300)">
          <img class="player-card-avatar" style="width:32px;height:32px" src="${playerAvatarUrl(p)}" alt="">
          <div class="player-card-info">
            <div class="player-card-name" style="font-size:12px">${p.firstName} ${p.lastName}</div>
            <div class="player-card-meta">
              <span class="pos-badge pos-${p.position}" style="font-size:9px;padding:1px 6px">${p.position}</span>
              <span class="text-muted text-sm">Age ${p.age}</span>
            </div>
          </div>
          <div class="ovr-badge ${ovrClass(p.ovr)}" style="font-size:11px">${p.ovr}</div>
        </div>
      `).join('')}

      ${recentMatches.length > 0 ? `
        <div class="card-title mb-8" style="margin-top:12px">Recent Results</div>
        ${recentMatches.map(m => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span>${m.homeName || 'Home'} ${m.homeGoals}-${m.awayGoals} ${m.awayName || 'Away'}</span>
            <span class="text-muted">MD${m.matchday}</span>
          </div>
        `).join('')}
      ` : ''}
    `);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function getOrdinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v-20)%10] || s[v] || s[0];
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    showApp();
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
  }

  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('reg-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });
});
