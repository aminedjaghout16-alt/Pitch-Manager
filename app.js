/* ─── Pitch Manager - Frontend Application ─────────────────────────────── */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('pm_token'),
  user: null,
  club: null,
  currentPage: null,
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

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
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
    state.user.club_id = data.club.id;
    state.club = data.club;
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function handleLogout() {
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

    if (!state.user.club_id) {
      document.getElementById('app').style.display = 'none';
      document.getElementById('club-create-screen').style.display = 'flex';
      return;
    }

    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateSidebar();
    navigate(location.hash || '#/dashboard');
  } catch (e) {
    handleLogout();
  }
}

function updateSidebar() {
  const el = document.getElementById('sidebar-club');
  if (!state.club) return;
  el.innerHTML = `
    <div class="club-name">${state.club.name}</div>
    <div class="club-info">${state.club.stadium} &middot; ${state.club.city}</div>
    <div class="club-info" style="margin-top:6px">Balance: <span class="money">${formatMoney(state.club.balance)}</span></div>
  `;
}

// ─── Router ──────────────────────────────────────────────────────────────────
function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  const route = hash.replace('#/', '') || 'dashboard';
  state.currentPage = route;

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === route);
  });

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Render page
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const pages = {
    dashboard: renderDashboard,
    squad: renderSquad,
    transfers: renderTransfers,
    training: renderTraining,
    matches: renderMatches,
    league: renderLeague,
    leaderboards: renderLeaderboards,
    finances: renderFinances,
    player: renderPlayerProfile,
    club: renderClubProfile,
    matchReport: renderMatchReport,
  };

  const render = pages[route] || renderDashboard;
  render(main);
}

window.addEventListener('hashchange', () => navigate(location.hash));

// ─── Dashboard ───────────────────────────────────────────────────────────────
async function renderDashboard(container) {
  try {
    const data = await api.get('/dashboard');
    const { club, season, standing, nextMatch, lastMatch, totalWages } = data;

    state.club = club;
    updateSidebar();

    let nextMatchHtml = '';
    if (nextMatch) {
      nextMatchHtml = `
        <div class="match-card">
          <div class="match-team">
            <div class="match-team-name">${nextMatch.home_name}</div>
            <div class="match-team-short">HOME</div>
          </div>
          <div>
            <div class="match-vs">Matchday ${season.current_matchday}</div>
            <div class="match-vs" style="font-size:12px;margin-top:4px">vs</div>
          </div>
          <div class="match-team">
            <div class="match-team-name">${nextMatch.away_name}</div>
            <div class="match-team-short">AWAY</div>
          </div>
        </div>
      `;
    } else {
      nextMatchHtml = '<div class="empty-state"><p>No upcoming match</p></div>';
    }

    let lastMatchHtml = '';
    if (lastMatch) {
      const isHome = lastMatch.home_team_id === club.id;
      const userGoals = isHome ? lastMatch.home_goals : lastMatch.away_goals;
      const oppGoals = isHome ? lastMatch.away_goals : lastMatch.home_goals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';

      lastMatchHtml = `
        <div class="match-card">
          <div class="match-team">
            <div class="match-team-name">${lastMatch.home_name}</div>
          </div>
          <div class="match-score">${lastMatch.home_goals} - ${lastMatch.away_goals}</div>
          <div class="match-team">
            <div class="match-team-name">${lastMatch.away_name}</div>
          </div>
        </div>
        <div class="text-center mt-8">
          <span class="result-badge result-${result}" style="width:auto;padding:4px 12px;font-size:13px">${result === 'W' ? 'Victory' : result === 'D' ? 'Draw' : 'Defeat'}</span>
        </div>
      `;
    } else {
      lastMatchHtml = '<div class="empty-state"><p>No matches played yet</p></div>';
    }

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Season ${season.id} &middot; Matchday ${season.current_matchday} of ${season.total_matchdays}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Balance</div>
          <div class="stat-value gold">${formatMoney(club.balance)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">League Position</div>
          <div class="stat-value green">${standing ? standing.position + '/' + 20 : '-'}</div>
          ${standing ? `<div class="stat-detail">${standing.points} pts &middot; ${standing.won}W ${standing.drawn}D ${standing.lost}L</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="stat-label">Squad Value</div>
          <div class="stat-value">${formatMoney(data.squadSummary ? data.squadSummary.reduce((s, r) => s, 0) : 0)}</div>
          <div class="stat-detail">${data.squadSummary ? data.squadSummary.reduce((s, r) => s + r.count, 0) : 0} players</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Weekly Wages</div>
          <div class="stat-value red">${formatMoney(totalWages)}</div>
          <div class="stat-detail">Transfer budget: ${formatMoney(club.transfer_budget)}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Next Match</span>
            <span class="card-subtitle">Matchday ${season.current_matchday}</span>
          </div>
          ${nextMatchHtml}
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Last Result</span>
          </div>
          ${lastMatchHtml}
        </div>
        <div class="card full-width">
          <div class="card-header">
            <span class="card-title">Quick Actions</span>
          </div>
          <div class="flex gap-8" style="flex-wrap:wrap">
            <a href="#/matches" class="btn btn-primary">Play Match</a>
            <a href="#/transfers" class="btn btn-gold">Transfer Market</a>
            <a href="#/training" class="btn btn-ghost">Training</a>
            <a href="#/squad" class="btn btn-ghost">View Squad</a>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Squad Page ──────────────────────────────────────────────────────────────
let squadSort = { col: 'ovr', order: 'desc' };
let squadFilter = '';

async function renderSquad(container) {
  try {
    const params = new URLSearchParams({ sort: squadSort.col, order: squadSort.order });
    if (squadFilter) params.set('position', squadFilter);
    const data = await api.get(`/squad?${params}`);

    const positions = ['', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
    const posOptions = positions.map(p => `<option value="${p}" ${squadFilter === p ? 'selected' : ''}>${p || 'All Positions'}</option>`).join('');

    const sortHeader = (col, label) => {
      const active = squadSort.col === col;
      const arrow = active ? (squadSort.order === 'asc' ? ' &#9650;' : ' &#9660;') : '';
      return `<th class="${active ? 'sorted' : ''}" onclick="sortSquad('${col}')">${label}${arrow}</th>`;
    };

    const rows = data.players.map(p => `
      <tr onclick="showPlayerProfile(${p.id})" style="cursor:pointer">
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary);font-weight:500">${p.first_name} ${p.last_name}</td>
        <td>${p.age}</td>
        <td>${formatMoney(p.value)}</td>
        <td>${formatMoney(p.salary)}/w</td>
        <td>
          ${p.fitness}%
          <div class="bar-container"><div class="bar-fill ${barColor(p.fitness)}" style="width:${p.fitness}%"></div></div>
        </td>
        <td>
          ${p.morale}%
          <div class="bar-container"><div class="bar-fill ${barColor(p.morale)}" style="width:${p.morale}%"></div></div>
        </td>
        ${p.injury_type ? `<td class="text-red text-sm">${p.injury_type}</td>` : '<td></td>'}
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1 class="page-title">Squad</h1>
          <p class="page-subtitle">${data.players.length} players</p>
        </div>
      </div>

      <div class="filter-bar">
        <select onchange="filterSquad(this.value)">${posOptions}</select>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              ${sortHeader('ovr', 'OVR')}
              ${sortHeader('position', 'POS')}
              ${sortHeader('value', 'Name')}
              ${sortHeader('age', 'Age')}
              ${sortHeader('value', 'Value')}
              ${sortHeader('salary', 'Salary')}
              ${sortHeader('fitness', 'Fitness')}
              ${sortHeader('morale', 'Morale')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function sortSquad(col) {
  if (squadSort.col === col) {
    squadSort.order = squadSort.order === 'desc' ? 'asc' : 'desc';
  } else {
    squadSort.col = col;
    squadSort.order = 'desc';
  }
  renderSquad(document.getElementById('main-content'));
}

function filterSquad(pos) {
  squadFilter = pos;
  renderSquad(document.getElementById('main-content'));
}

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
        <div class="player-detail-ovr ${ovrClass(p.ovr)}" style="padding:8px 12px;border-radius:8px;background:var(--bg-input)">${p.ovr}</div>
        <div>
          <div class="player-detail-name">${p.first_name} ${p.last_name}</div>
          <div class="player-detail-info">
            <span class="pos-badge pos-${p.position}">${p.position}</span>
            &middot; Age ${p.age} &middot; Potential ${p.potential}
          </div>
        </div>
      </div>
      <div class="player-attrs">${attrHtml}</div>
      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="attr-row"><span class="attr-label">Value</span><span class="attr-value text-gold">${formatMoney(p.value)}</span></div>
        <div class="attr-row"><span class="attr-label">Salary</span><span class="attr-value">${formatMoney(p.salary)}/w</span></div>
        <div class="attr-row"><span class="attr-label">Fitness</span><span class="attr-value">${p.fitness}%</span></div>
        <div class="attr-row"><span class="attr-label">Morale</span><span class="attr-value">${p.morale}%</span></div>
      </div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn btn-danger btn-sm" onclick="sellPlayer(${p.id}, '${p.first_name} ${p.last_name}')">List for Sale</button>
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
    renderSquad(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Transfer Market ─────────────────────────────────────────────────────────
let transferSort = { col: 'ovr', order: 'desc' };
let transferFilter = '';

async function renderTransfers(container) {
  try {
    const params = new URLSearchParams({ sort: transferSort.col, order: transferSort.order });
    if (transferFilter) params.set('position', transferFilter);
    const data = await api.get(`/transfers/market?${params}`);

    const positions = ['', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
    const posOptions = positions.map(p => `<option value="${p}" ${transferFilter === p ? 'selected' : ''}>${p || 'All Positions'}</option>`).join('');

    const rows = data.players.map(p => `
      <tr>
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary);font-weight:500">${p.first_name} ${p.last_name}</td>
        <td>${p.age}</td>
        <td>${p.potential}</td>
        <td class="money">${formatMoney(p.asking_price)}</td>
        <td>${formatMoney(p.value)}</td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="buyPlayer(${p.id}, '${p.first_name} ${p.last_name}', ${p.asking_price})"
            ${p.asking_price > data.budget ? 'disabled title="Insufficient budget"' : ''}>
            Sign
          </button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Transfer Market</h1>
        <p class="page-subtitle">${data.players.length} players available &middot; Budget: <span class="money">${formatMoney(data.budget)}</span></p>
      </div>

      <div class="filter-bar">
        <select onchange="filterTransfers(this.value)">${posOptions}</select>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th onclick="sortTransfers('ovr')">OVR</th>
              <th>POS</th>
              <th>Name</th>
              <th onclick="sortTransfers('age')">Age</th>
              <th onclick="sortTransfers('potential')">Pot</th>
              <th onclick="sortTransfers('asking_price')">Price</th>
              <th>Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function sortTransfers(col) {
  if (transferSort.col === col) {
    transferSort.order = transferSort.order === 'desc' ? 'asc' : 'desc';
  } else {
    transferSort.col = col;
    transferSort.order = 'desc';
  }
  renderTransfers(document.getElementById('main-content'));
}

function filterTransfers(pos) {
  transferFilter = pos;
  renderTransfers(document.getElementById('main-content'));
}

async function buyPlayer(playerId, name, price) {
  if (!confirm(`Sign ${name} for ${formatMoney(price)}?`)) return;
  try {
    const data = await api.post(`/transfers/buy/${playerId}`);
    showToast(data.message);
    // Refresh club data
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateSidebar();
    renderTransfers(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Training Page ───────────────────────────────────────────────────────────
let trainingFocus = 'general';

async function renderTraining(container) {
  try {
    const data = await api.get('/training');

    const focusOptions = ['general', 'pace', 'shooting', 'passing', 'defending', 'physical'];
    const focusBtns = focusOptions.map(f => `
      <button class="focus-btn ${trainingFocus === f ? 'active' : ''}" onclick="setTrainingFocus('${f}')">
        ${f.charAt(0).toUpperCase() + f.slice(1)}
      </button>
    `).join('');

    const rows = data.players.map(p => `
      <tr>
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary);font-weight:500">${p.first_name} ${p.last_name}</td>
        <td>${p.age}</td>
        <td class="text-muted">${p.potential}</td>
        <td>
          ${p.fitness}%
          <div class="bar-container"><div class="bar-fill ${barColor(p.fitness)}" style="width:${p.fitness}%"></div></div>
        </td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="trainPlayer(${p.id}, '${p.first_name} ${p.last_name}')"
            ${p.fitness < 30 ? 'disabled' : ''}>
            Train
          </button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1 class="page-title">Training</h1>
          <p class="page-subtitle">${data.players.length} players &middot; Focus: ${trainingFocus}</p>
        </div>
        <button class="btn btn-gold" onclick="trainBatch()">Train All ($${(data.players.filter(p => p.fitness >= 30).length * 10000).toLocaleString()})</button>
      </div>

      <div class="training-controls">${focusBtns}</div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>OVR</th>
              <th>POS</th>
              <th>Name</th>
              <th>Age</th>
              <th>Pot</th>
              <th>Fitness</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function setTrainingFocus(focus) {
  trainingFocus = focus;
  renderTraining(document.getElementById('main-content'));
}

async function trainPlayer(playerId, name) {
  try {
    const data = await api.post(`/training/${playerId}`, { focus: trainingFocus });
    const improvements = Object.entries(data.improvements || {}).map(([k, v]) => `${k} +${v - data.player[k]}`).join(', ');
    showToast(`${name} trained! ${improvements || 'No improvement this time'}`);
    renderTraining(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function trainBatch() {
  if (!confirm(`Train entire squad with focus: ${trainingFocus}?`)) return;
  try {
    const data = await api.post('/training/batch', { focus: trainingFocus });
    showToast(data.message);
    renderTraining(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Matches Page ────────────────────────────────────────────────────────────
async function renderMatches(container) {
  try {
    const data = await api.get('/matches/current');

    let matchListHtml = '';
    if (data.matches && data.matches.length > 0) {
      matchListHtml = data.matches.map(m => {
        const isUser = m.home_team_id === state.club?.id || m.away_team_id === state.club?.id;
        const clickable = m.simulated ? `onclick="showMatchReport(${m.id})" style="cursor:pointer"` : '';
        return `
          <div class="match-list-item" ${clickable} style="${isUser ? 'background:rgba(26,122,90,0.08)' : ''}">
            <span class="match-list-team">${m.home_name}</span>
            <span class="match-list-score ${m.simulated ? '' : 'pending'}">
              ${m.simulated ? `${m.home_goals} - ${m.away_goals}` : 'vs'}
            </span>
            <span class="match-list-team">${m.away_name}</span>
            ${m.simulated ? '<span class="text-muted text-sm">Report &rarr;</span>' : ''}
          </div>
        `;
      }).join('');
    }

    let userMatchHtml = '';
    if (data.userMatch && data.userMatch.simulated) {
      const events = data.userMatch.events ? JSON.parse(data.userMatch.events) : [];
      const eventsHtml = events.map(e => {
        const isHome = e.team === 'home';
        const teamName = isHome ? data.userMatch.home_short : data.userMatch.away_short;
        const isYou = (isHome && data.userMatch.home_team_id === state.club?.id) || (!isHome && data.userMatch.away_team_id === state.club?.id);
        return `
          <div class="match-event">
            <span class="minute">${e.minute}'</span>
            &#9917; ${e.player} (${isYou ? 'You' : teamName})
          </div>
        `;
      }).join('');

      userMatchHtml = `
        <div class="card mt-16">
          <div class="card-header"><span class="card-title">Match Events</span></div>
          <div class="match-events">${eventsHtml || '<p class="text-muted">No goals</p>'}</div>
        </div>
      `;
    }

    const allSimulated = data.matches?.every(m => m.simulated);
    const anyUnsimulated = data.matches?.some(m => !m.simulated);

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Matches</h1>
        <p class="page-subtitle">Matchday ${data.matchday} &middot; Season ${data.status}</p>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <span class="card-title">Matchday ${data.matchday} Fixtures</span>
          <div class="flex gap-8">
            ${anyUnsimulated ? `<button class="btn btn-primary" onclick="simulateMatch()">Simulate Matchday</button>` : ''}
            ${allSimulated ? `<button class="btn btn-gold" onclick="advanceMatchday()">Advance to Next Matchday</button>` : ''}
          </div>
        </div>
        ${matchListHtml || '<div class="empty-state"><p>No fixtures</p></div>'}
      </div>

      ${userMatchHtml}

      <div class="card mt-16">
        <div class="card-header">
          <span class="card-title">Recent Results</span>
          <a href="#/matches" class="btn btn-ghost btn-sm" onclick="loadHistory()">View All</a>
        </div>
        <div id="match-history"></div>
      </div>
    `;

    // Load recent history
    loadHistory();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

async function loadHistory() {
  try {
    const data = await api.get('/matches/history');
    const historyEl = document.getElementById('match-history');
    if (!historyEl) return;

    if (data.matches.length === 0) {
      historyEl.innerHTML = '<div class="empty-state"><p>No matches played yet</p></div>';
      return;
    }

    historyEl.innerHTML = data.matches.slice(0, 10).map(m => {
      const isHome = m.home_team_id === state.club?.id;
      const userGoals = isHome ? m.home_goals : m.away_goals;
      const oppGoals = isHome ? m.away_goals : m.home_goals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';

      return `
        <div class="match-list-item" onclick="showMatchReport(${m.id})" style="cursor:pointer">
          <span class="text-muted text-sm" style="min-width:30px">MD${m.matchday}</span>
          <span class="match-list-team">${m.home_name}</span>
          <span class="match-list-score">${m.home_goals} - ${m.away_goals}</span>
          <span class="match-list-team">${m.away_name}</span>
          <span class="result-badge result-${result}">${result}</span>
        </div>
      `;
    }).join('');
  } catch (e) { /* silent */ }
}

async function simulateMatch() {
  try {
    const data = await api.post('/matches/simulate');
    if (data.userResult) {
      const r = data.userResult;
      const userGoals = r.isHome ? r.homeGoals : r.awayGoals;
      const oppGoals = r.isHome ? r.awayGoals : r.homeGoals;
      const result = userGoals > oppGoals ? 'Victory!' : userGoals < oppGoals ? 'Defeat' : 'Draw';
      showToast(`${result} ${userGoals} - ${oppGoals}`, userGoals >= oppGoals ? 'success' : 'error');
    }
    renderMatches(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function advanceMatchday() {
  try {
    const data = await api.post('/matches/advance');
    if (data.finished) {
      showToast('Season finished! Check the league table for final standings.', 'info');
    } else {
      showToast(`Advanced to matchday ${data.matchday}`);
    }
    const clubData = await api.get('/club');
    state.club = clubData.club;
    updateSidebar();
    renderMatches(document.getElementById('main-content'));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── League Page ─────────────────────────────────────────────────────────────
async function renderLeague(container) {
  try {
    const data = await api.get('/league');

    const rows = data.standings.map(s => {
      const isUser = s.club_id === state.club?.id;
      const isRelegation = s.position > 17;
      return `
        <tr class="${isUser ? 'highlight' : ''} ${isRelegation ? 'relegation' : ''}">
          <td>${s.position}</td>
          <td style="color:var(--text-primary);font-weight:${isUser ? '700' : '500'};cursor:pointer" onclick="showClubProfile(${s.club_id})">${s.name}</td>
          <td>${s.played}</td>
          <td>${s.won}</td>
          <td>${s.drawn}</td>
          <td>${s.lost}</td>
          <td>${s.goals_for}</td>
          <td>${s.goals_against}</td>
          <td>${s.goal_difference > 0 ? '+' : ''}${s.goal_difference}</td>
          <td style="font-weight:800;color:var(--gold)">${s.points}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">League Table</h1>
        <p class="page-subtitle">Matchday ${data.season.current_matchday} of ${data.season.total_matchdays} &middot; ${data.season.status}</p>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Club</th>
              <th>P</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GF</th>
              <th>GA</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="flex gap-16 mt-16 text-sm text-muted">
        <span><span style="display:inline-block;width:12px;height:12px;background:rgba(26,122,90,0.3);border-radius:2px;vertical-align:middle;margin-right:4px"></span> Your club</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:rgba(224,85,85,0.2);border-radius:2px;vertical-align:middle;margin-right:4px"></span> Relegation zone</span>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Finances Page ───────────────────────────────────────────────────────────
async function renderFinances(container) {
  try {
    const data = await api.get('/finances');

    const wageRows = data.players.slice(0, 15).map(p => `
      <tr>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary)">${p.first_name} ${p.last_name}</td>
        <td>${p.age}</td>
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td class="money">${formatMoney(p.salary)}/w</td>
        <td>${formatMoney(p.value)}</td>
      </tr>
    `).join('');

    const transferRows = data.recentTransfers.slice(0, 10).map(t => `
      <tr>
        <td>MD${t.matchday}</td>
        <td style="color:var(--text-primary)">${t.first_name} ${t.last_name}</td>
        <td>${t.to_club_id === state.club?.id ? '<span class="text-green">In</span>' : '<span class="text-red">Out</span>'}</td>
        <td class="money">${formatMoney(t.fee)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Finances</h1>
        <p class="page-subtitle">Club financial overview</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Balance</div>
          <div class="stat-value gold">${formatMoney(data.club.balance)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Transfer Budget</div>
          <div class="stat-value green">${formatMoney(data.club.transfer_budget)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Weekly Wages</div>
          <div class="stat-value red">${formatMoney(data.totalWages)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Squad Value</div>
          <div class="stat-value">${formatMoney(data.totalValue)}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Wage Bill</span>
            <span class="card-subtitle">Top earners</span>
          </div>
          <div class="table-container" style="border:none">
            <table>
              <thead><tr><th>POS</th><th>Name</th><th>Age</th><th>OVR</th><th>Salary</th><th>Value</th></tr></thead>
              <tbody>${wageRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Transfer History</span>
          </div>
          ${transferRows ? `
            <div class="table-container" style="border:none">
              <table>
                <thead><tr><th>MD</th><th>Player</th><th>Dir</th><th>Fee</th></tr></thead>
                <tbody>${transferRows}</tbody>
              </table>
            </div>
          ` : '<div class="empty-state"><p>No transfers yet</p></div>'}
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Leaderboards Page ───────────────────────────────────────────────────────
async function renderLeaderboards(container) {
  try {
    const data = await api.get('/leaderboards');

    const renderTable = (players, stat, label) => {
      const rows = players.map((p, i) => `
        <tr onclick="showPlayerProfile(${p.id})" style="cursor:pointer">
          <td>${i + 1}</td>
          <td style="color:var(--text-primary);font-weight:500">${p.first_name} ${p.last_name}</td>
          <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
          <td class="text-muted">${p.club_name}</td>
          <td style="font-weight:700;color:var(--gold)">${p[stat]}</td>
        </tr>
      `).join('');

      return `
        <div class="card">
          <div class="card-header"><span class="card-title">${label}</span></div>
          <div class="table-container" style="border:none">
            <table>
              <thead><tr><th>#</th><th>Player</th><th>POS</th><th>Club</th><th>${label}</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" class="text-center text-muted">No data yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Leaderboards</h1>
        <p class="page-subtitle">Season statistics and rankings</p>
      </div>

      <div class="dashboard-grid">
        ${renderTable(data.topScorers, 'goals', 'Top Scorers')}
        ${renderTable(data.topAssists, 'assists', 'Top Assists')}
        ${renderTable(data.highestOvr, 'ovr', 'Highest Rated')}
        ${renderTable(data.mostValuable, 'value', 'Most Valuable')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

// ─── Player Profile ──────────────────────────────────────────────────────────
async function renderPlayerProfile(container) {
  const playerId = location.hash.split('/')[2];
  if (!playerId) { navigate('#/squad'); return; }

  try {
    const data = await api.get(`/players/${playerId}`);
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

    const seasonStats = `
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card">
          <div class="stat-label">Appearances</div>
          <div class="stat-value">${p.appearances}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Goals</div>
          <div class="stat-value text-gold">${p.goals}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Assists</div>
          <div class="stat-value text-green">${p.assists}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Cards</div>
          <div class="stat-value">${p.yellow_cards}Y ${p.red_cards}R</div>
        </div>
      </div>
    `;

    let injuryHtml = '';
    if (p.injury_type) {
      injuryHtml = `
        <div class="card mt-16" style="border-color:var(--red)">
          <div class="card-header">
            <span class="card-title text-red">Injured</span>
          </div>
          <p>${p.injury_type} - ${p.injury_weeks} week${p.injury_weeks !== 1 ? 's' : ''} remaining</p>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="page-header">
        <a href="#/squad" class="btn btn-ghost btn-sm mb-16">&larr; Back to Squad</a>
      </div>

      <div class="card">
        <div class="player-detail-header">
          <div class="player-detail-ovr ${ovrClass(p.ovr)}" style="padding:12px 16px;border-radius:8px;background:var(--bg-input)">${p.ovr}</div>
          <div>
            <div class="player-detail-name">${p.first_name} ${p.last_name}</div>
            <div class="player-detail-info">
              <span class="pos-badge pos-${p.position}">${p.position}</span>
              &middot; Age ${p.age} &middot; ${data.clubName}
            </div>
            <div class="text-sm text-muted mt-8">Potential: ${p.potential}</div>
          </div>
        </div>

        ${seasonStats}

        <div class="card-header mt-24"><span class="card-title">Attributes</span></div>
        <div class="player-attrs">${attrHtml}</div>

        <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="attr-row"><span class="attr-label">Value</span><span class="attr-value text-gold">${formatMoney(p.value)}</span></div>
          <div class="attr-row"><span class="attr-label">Salary</span><span class="attr-value">${formatMoney(p.salary)}/w</span></div>
          <div class="attr-row"><span class="attr-label">Fitness</span><span class="attr-value">${p.fitness}%</span></div>
          <div class="attr-row"><span class="attr-label">Morale</span><span class="attr-value">${p.morale}%</span></div>
        </div>

        ${injuryHtml}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function showPlayerProfile(playerId) {
  navigate(`#/player/${playerId}`);
}

// ─── Club Profile ────────────────────────────────────────────────────────────
async function renderClubProfile(container) {
  const clubId = location.hash.split('/')[2];
  if (!clubId) { navigate('#/league'); return; }

  try {
    const data = await api.get(`/clubs/${clubId}`);
    const c = data.club;

    const matchRows = data.recentMatches.map(m => {
      const isHome = m.home_team_id === c.id;
      const userGoals = isHome ? m.home_goals : m.away_goals;
      const oppGoals = isHome ? m.away_goals : m.home_goals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';
      return `
        <div class="match-list-item">
          <span class="text-muted text-sm" style="min-width:30px">MD${m.matchday}</span>
          <span class="match-list-team">${m.home_name}</span>
          <span class="match-list-score">${m.home_goals} - ${m.away_goals}</span>
          <span class="match-list-team">${m.away_name}</span>
          <span class="result-badge result-${result}">${result}</span>
        </div>
      `;
    }).join('');

    const topPlayers = data.squad.slice(0, 10).map(p => `
      <tr onclick="showPlayerProfile(${p.id})" style="cursor:pointer">
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary)">${p.first_name} ${p.last_name}</td>
        <td>${p.age}</td>
        <td>${p.goals}</td>
        <td>${p.assists}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header">
        <a href="#/league" class="btn btn-ghost btn-sm mb-16">&larr; Back to League</a>
      </div>

      <div class="card mb-24">
        <h1 class="page-title">${c.name}</h1>
        <p class="page-subtitle">${c.stadium} &middot; ${c.city}</p>

        <div class="stats-grid mt-24">
          <div class="stat-card">
            <div class="stat-label">League Position</div>
            <div class="stat-value text-gold">${data.standing?.position || '-'}/20</div>
            <div class="stat-detail">${data.standing?.points || 0} points</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Squad Value</div>
            <div class="stat-value">${formatMoney(data.totalValue)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg OVR</div>
            <div class="stat-value text-green">${data.avgOvr}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Balance</div>
            <div class="stat-value">${formatMoney(c.balance)}</div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">Key Players</span></div>
          <div class="table-container" style="border:none">
            <table>
              <thead><tr><th>OVR</th><th>POS</th><th>Name</th><th>Age</th><th>G</th><th>A</th></tr></thead>
              <tbody>${topPlayers}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Recent Matches</span></div>
          ${matchRows || '<div class="empty-state"><p>No matches played yet</p></div>'}
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function showClubProfile(clubId) {
  navigate(`#/club/${clubId}`);
}

// ─── Match Report ────────────────────────────────────────────────────────────
async function renderMatchReport(container) {
  const matchId = location.hash.split('/')[2];
  if (!matchId) { navigate('#/matches'); return; }

  try {
    const data = await api.get(`/matches/report/${matchId}`);
    const m = data.match;

    const eventsHtml = data.events.map(e => {
      const icon = e.type === 'goal' ? '&#9917;' : e.type === 'yellow' ? '&#9888;' : '&#10060;';
      const color = e.type === 'goal' ? 'var(--green-bright)' : e.type === 'yellow' ? 'var(--gold)' : 'var(--red)';
      return `
        <div class="match-event">
          <span class="minute">${e.minute}'</span>
          <span style="color:${color}">${icon}</span>
          ${e.player}${e.assist ? ` (assist: ${e.assist})` : ''}
        </div>
      `;
    }).join('');

    const statsHtml = `
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="stat-label">Possession</div>
          <div class="stat-value">${data.stats.home.possession}% - ${data.stats.away.possession}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Shots (On Target)</div>
          <div class="stat-value">${data.stats.home.shots} (${data.stats.home.shotsOnTarget}) - ${data.stats.away.shots} (${data.stats.away.shotsOnTarget})</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Corners / Fouls</div>
          <div class="stat-value">${data.stats.home.corners}/${data.stats.home.fouls} - ${data.stats.away.corners}/${data.stats.away.fouls}</div>
        </div>
      </div>
    `;

    const ratingsHtml = data.playerRatings.slice(0, 15).map(pr => `
      <tr>
        <td style="color:var(--text-primary)">${pr.name}</td>
        <td class="text-muted">${pr.team === 'home' ? m.home_short : m.away_short}</td>
        <td>${pr.goals > 0 ? pr.goals + 'G' : ''} ${pr.assists > 0 ? pr.assists + 'A' : ''}</td>
        <td style="font-weight:700;color:${pr.rating >= 7.5 ? 'var(--green-bright)' : pr.rating >= 6.5 ? 'var(--gold)' : 'var(--red)'}">
          ${pr.rating.toFixed(1)}
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-header">
        <a href="#/matches" class="btn btn-ghost btn-sm mb-16">&larr; Back to Matches</a>
      </div>

      <div class="card mb-24">
        <div class="match-card">
          <div class="match-team">
            <div class="match-team-name">${m.home_name}</div>
            <div class="match-team-short">HOME</div>
          </div>
          <div class="match-score">${m.home_goals} - ${m.away_goals}</div>
          <div class="match-team">
            <div class="match-team-name">${m.away_name}</div>
            <div class="match-team-short">AWAY</div>
          </div>
        </div>
        <div class="text-center text-muted text-sm">Matchday ${m.matchday}</div>
      </div>

      ${statsHtml}

      <div class="dashboard-grid mt-24">
        <div class="card">
          <div class="card-header"><span class="card-title">Match Events</span></div>
          <div class="match-events">${eventsHtml || '<p class="text-muted">No events</p>'}</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Player Ratings</span></div>
          <div class="table-container" style="border:none">
            <table>
              <thead><tr><th>Player</th><th>Team</th><th>Stats</th><th>Rating</th></tr></thead>
              <tbody>${ratingsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function showMatchReport(matchId) {
  navigate(`#/matchReport/${matchId}`);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    showApp();
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
  }

  // Enter key handlers for auth forms
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('reg-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });
});
