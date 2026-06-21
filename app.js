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

// Generates a stable "random" face for a player. Seeding on the player's id
// means each player always gets the same face (instead of a new random one
// on every re-render), while different players look different from each other.
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
    state.user.clubId = data.club.id;
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

    if (!state.user.clubId) {
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
    tactics: renderTactics,
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
            <div class="match-team-name">${nextMatch.homeName}</div>
            <div class="match-team-short">HOME</div>
          </div>
          <div>
            <div class="match-vs">Matchday ${season.currentMatchday}</div>
            <div class="match-vs" style="font-size:12px;margin-top:4px">vs</div>
          </div>
          <div class="match-team">
            <div class="match-team-name">${nextMatch.awayName}</div>
            <div class="match-team-short">AWAY</div>
          </div>
        </div>
      `;
    } else {
      nextMatchHtml = '<div class="empty-state"><p>No upcoming match</p></div>';
    }

    let lastMatchHtml = '';
    if (lastMatch) {
      const isHome = lastMatch.homeTeamId === club.id;
      const userGoals = isHome ? lastMatch.homeGoals : lastMatch.awayGoals;
      const oppGoals = isHome ? lastMatch.awayGoals : lastMatch.homeGoals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';

      lastMatchHtml = `
        <div class="match-card">
          <div class="match-team">
            <div class="match-team-name">${lastMatch.homeName}</div>
          </div>
          <div class="match-score">${lastMatch.homeGoals} - ${lastMatch.awayGoals}</div>
          <div class="match-team">
            <div class="match-team-name">${lastMatch.awayName}</div>
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
        <p class="page-subtitle">Season ${season.id} &middot; Matchday ${season.currentMatchday} of ${season.totalMatchdays}</p>
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
          <div class="stat-detail">Transfer budget: ${formatMoney(club.transferBudget)}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Next Match</span>
            <span class="card-subtitle">Matchday ${season.currentMatchday}</span>
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
        <td style="color:var(--text-primary);font-weight:500">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
            ${p.firstName} ${p.lastName}
          </div>
        </td>
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
        ${p.injuryType ? `<td class="text-red text-sm">${p.injuryType}</td>` : '<td></td>'}
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
        <img class="player-avatar-lg" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
        <div class="player-detail-ovr ${ovrClass(p.ovr)}" style="padding:8px 12px;border-radius:8px;background:var(--bg-input)">${p.ovr}</div>
        <div>
          <div class="player-detail-name">${p.firstName} ${p.lastName}</div>
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
        <td style="color:var(--text-primary);font-weight:500">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
            ${p.firstName} ${p.lastName}
          </div>
        </td>
        <td>${p.age}</td>
        <td>${p.potential}</td>
        <td class="money">${formatMoney(p.askingPrice)}</td>
        <td>${formatMoney(p.value)}</td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="buyPlayer(${p.id}, '${p.firstName} ${p.lastName}', ${p.askingPrice})"
            ${p.askingPrice > data.budget ? 'disabled title="Insufficient budget"' : ''}>
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
              <th onclick="sortTransfers('askingPrice')">Price</th>
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
        <td style="color:var(--text-primary);font-weight:500">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
            ${p.firstName} ${p.lastName}
          </div>
        </td>
        <td>${p.age}</td>
        <td class="text-muted">${p.potential}</td>
        <td>
          ${p.fitness}%
          <div class="bar-container"><div class="bar-fill ${barColor(p.fitness)}" style="width:${p.fitness}%"></div></div>
        </td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="trainPlayer(${p.id}, '${p.firstName} ${p.lastName}')"
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

// ─── Tactics Page ────────────────────────────────────────────────────────────
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
    {role:'GK',x:50,y:90},{role:'LWB',x:10,y:68},{role:'CB',x:30,y:78},{role:'CB',x:50,y:80},{role:'CB',x:70,y:78},{role:'RWB',x:90,y:68},
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

let tacticsState = {
  formation: '4-4-2',
  mentality: 'balanced',
  pressing: 'normal',
  tempo: 'normal',
  passingStyle: 'mixed',
  captainId: null,
  lineup: {},
  players: [],
  selectedSlot: null,
};

async function renderTactics(container) {
  try {
    const data = await api.get('/tactics');
    const t = data.tactics;
    tacticsState = {
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
    drawTacticsPage(container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
  }
}

function drawTacticsPage(container) {
  const slots = FORMATIONS[tacticsState.formation];
  const assignedIds = Object.values(tacticsState.lineup);
  const unassigned = tacticsState.players.filter(p => !assignedIds.includes(p.id));

  const formationBtns = Object.keys(FORMATIONS).map(f =>
    `<button class="formation-btn ${tacticsState.formation === f ? 'active' : ''}" onclick="selectFormation('${f}')">${f}</button>`
  ).join('');

  const pitchSlots = slots.map((slot, i) => {
    const playerId = tacticsState.lineup[i];
    const player = tacticsState.players.find(p => p.id === playerId);
    const isSelected = tacticsState.selectedSlot === i;
    const isCaptain = player && player.id === tacticsState.captainId;
    return `
      <div class="pitch-player ${isSelected ? 'selected' : ''} ${player ? 'filled' : 'empty'}"
           style="left:${slot.x}%;top:${slot.y}%"
           onclick="selectSlot(${i})">
        <div class="pitch-player-circle">
          ${player ? `<img class="pitch-player-avatar" src="${playerAvatarUrl(player)}" alt="">` : `<span class="pitch-player-plus">+</span>`}
        </div>
        <div class="pitch-player-name">
          ${player ? `${player.lastName}${isCaptain ? ' &#169;' : ''}` : slot.role}
        </div>
        <div class="pitch-player-role">${slot.role}</div>
      </div>
    `;
  }).join('');

  const mentalityBtns = ['defensive','counter','balanced','attacking','all-out'].map(m =>
    `<button class="tactic-opt ${tacticsState.mentality === m ? 'active' : ''}" onclick="setTacticOpt('mentality','${m}')">${m.replace('-',' ')}</button>`
  ).join('');

  const pressingBtns = ['low','normal','high','gegenpress'].map(p =>
    `<button class="tactic-opt ${tacticsState.pressing === p ? 'active' : ''}" onclick="setTacticOpt('pressing','${p}')">${p === 'gegenpress' ? 'Gegenpress' : p}</button>`
  ).join('');

  const tempoBtns = ['slow','normal','fast','relentless'].map(t =>
    `<button class="tactic-opt ${tacticsState.tempo === t ? 'active' : ''}" onclick="setTacticOpt('tempo','${t}')">${t}</button>`
  ).join('');

  const passingBtns = ['short','mixed','long','direct'].map(p =>
    `<button class="tactic-opt ${tacticsState.passingStyle === p ? 'active' : ''}" onclick="setTacticOpt('passingStyle','${p}')">${p}</button>`
  ).join('');

  const benchHtml = unassigned.slice(0, 12).map(p => `
    <div class="bench-player" onclick="showPlayerProfile('${p.id}')">
      <span class="pos-badge pos-${p.position}">${p.position}</span>
      <span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span>
      <span class="bench-player-name">${p.firstName} ${p.lastName}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Tactics</h1>
      <p class="page-subtitle">Set your formation, lineup, and game plan</p>
    </div>

    <div class="tactics-layout">
      <div class="tactics-left">
        <div class="card tactics-pitch-card">
          <div class="card-header">
            <span class="card-title">Formation</span>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" onclick="autoFillLineup()">Auto XI</button>
              <button class="btn btn-primary btn-sm" onclick="saveTactics()">Save</button>
            </div>
          </div>
          <div class="formation-selector">${formationBtns}</div>
          <div class="pitch-container">
            <div class="pitch">
              <div class="pitch-markings">
                <div class="pitch-center-circle"></div>
                <div class="pitch-center-line"></div>
                <div class="pitch-box-top"></div>
                <div class="pitch-box-bottom"></div>
                <div class="pitch-goal-top"></div>
                <div class="pitch-goal-bottom"></div>
                <div class="pitch-corner-tl"></div>
                <div class="pitch-corner-tr"></div>
                <div class="pitch-corner-bl"></div>
                <div class="pitch-corner-br"></div>
              </div>
              ${pitchSlots}
            </div>
          </div>
        </div>
      </div>

      <div class="tactics-right">
        ${tacticsState.selectedSlot !== null ? renderSlotPicker() : ''}

        <div class="card">
          <div class="card-header"><span class="card-title">Mentality</span></div>
          <div class="tactic-options">${mentalityBtns}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Pressing</span></div>
          <div class="tactic-options">${pressingBtns}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Tempo</span></div>
          <div class="tactic-options">${tempoBtns}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Passing Style</span></div>
          <div class="tactic-options">${passingBtns}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Substitutes</span><span class="card-subtitle">${unassigned.length} available</span></div>
          <div class="bench-list">${benchHtml || '<p class="text-muted text-sm">All players assigned</p>'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderSlotPicker() {
  const slot = FORMATIONS[tacticsState.formation][tacticsState.selectedSlot];
  const assignedIds = Object.values(tacticsState.lineup);
  const currentId = tacticsState.lineup[tacticsState.selectedSlot];

  const candidates = tacticsState.players
    .filter(p => p.id !== currentId || !currentId)
    .filter(p => {
      if (p.id && assignedIds.includes(p.id)) return false;
      return true;
    })
    .sort((a, b) => {
      const aMatch = a.position === slot.role ? 0 : 1;
      const bMatch = b.position === slot.role ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return b.ovr - a.ovr;
    });

  const rows = candidates.slice(0, 15).map(p => {
    const posMatch = p.position === slot.role;
    return `
      <div class="slot-picker-player ${posMatch ? 'pos-match' : ''}" onclick="assignPlayerToSlot('${p.id}')">
        <span class="pos-badge pos-${p.position}">${p.position}</span>
        <span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span>
        <span class="slot-picker-name">${p.firstName} ${p.lastName}</span>
        ${p.id === tacticsState.captainId ? '<span class="captain-badge-cp">&#169;</span>' : ''}
      </div>
    `;
  }).join('');

  const currentPlayer = tacticsState.players.find(p => p.id === currentId);

  return `
    <div class="card slot-picker-card">
      <div class="card-header">
        <span class="card-title">Assign ${slot.role}</span>
        <button class="btn btn-ghost btn-xs" onclick="clearSlot()">&times; Clear</button>
      </div>
      ${currentPlayer ? `
        <div class="slot-current">
          Current: <strong>${currentPlayer.firstName} ${currentPlayer.lastName}</strong>
          <span class="pos-badge pos-${currentPlayer.position}">${currentPlayer.position}</span>
          <span class="ovr-badge ${ovrClass(currentPlayer.ovr)}">${currentPlayer.ovr}</span>
          <button class="btn btn-ghost btn-xs" onclick="setCaptain('${currentPlayer.id}')" style="margin-left:8px">&#169; Captain</button>
        </div>
      ` : ''}
      <div class="slot-picker-list">${rows}</div>
    </div>
  `;
}

function selectFormation(f) {
  tacticsState.formation = f;
  tacticsState.lineup = {};
  tacticsState.selectedSlot = null;
  drawTacticsPage(document.getElementById('main-content'));
}

function selectSlot(i) {
  tacticsState.selectedSlot = tacticsState.selectedSlot === i ? null : i;
  drawTacticsPage(document.getElementById('main-content'));
}

function clearSlot() {
  delete tacticsState.lineup[tacticsState.selectedSlot];
  tacticsState.selectedSlot = null;
  drawTacticsPage(document.getElementById('main-content'));
}

function assignPlayerToSlot(playerId) {
  const prevSlot = Object.entries(tacticsState.lineup).find(([k, v]) => v === playerId);
  if (prevSlot) delete tacticsState.lineup[prevSlot[0]];
  tacticsState.lineup[tacticsState.selectedSlot] = playerId;
  tacticsState.selectedSlot = null;
  drawTacticsPage(document.getElementById('main-content'));
}

function setCaptain(playerId) {
  tacticsState.captainId = tacticsState.captainId === playerId ? null : playerId;
  drawTacticsPage(document.getElementById('main-content'));
}

function setTacticOpt(key, value) {
  tacticsState[key] = value;
  drawTacticsPage(document.getElementById('main-content'));
}

function autoFillLineup() {
  const slots = FORMATIONS[tacticsState.formation];
  const lineup = {};
  const used = new Set();

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const candidates = tacticsState.players
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
  tacticsState.lineup = lineup;
  tacticsState.selectedSlot = null;
  drawTacticsPage(document.getElementById('main-content'));
}

async function saveTactics() {
  try {
    await api.post('/tactics', {
      formation: tacticsState.formation,
      mentality: tacticsState.mentality,
      pressing: tacticsState.pressing,
      tempo: tacticsState.tempo,
      passingStyle: tacticsState.passingStyle,
      captainId: tacticsState.captainId,
      lineup: tacticsState.lineup,
    });
    showToast('Tactics saved!');
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
        const isUser = m.homeTeamId === state.club?.id || m.awayTeamId === state.club?.id;
        const clickable = m.simulated ? `onclick="showMatchReport(${m.id})" style="cursor:pointer"` : '';
        return `
          <div class="match-list-item" ${clickable} style="${isUser ? 'background:rgba(26,122,90,0.08)' : ''}">
            <span class="match-list-team">${m.homeName}</span>
            <span class="match-list-score ${m.simulated ? '' : 'pending'}">
              ${m.simulated ? `${m.homeGoals} - ${m.awayGoals}` : 'vs'}
            </span>
            <span class="match-list-team">${m.awayName}</span>
            ${m.simulated ? '<span class="text-muted text-sm">Report &rarr;</span>' : ''}
          </div>
        `;
      }).join('');
    }

    let userMatchHtml = '';
    if (data.userMatch && data.userMatch.simulated) {
      const events = Array.isArray(data.userMatch.events) ? data.userMatch.events : (data.userMatch.events ? JSON.parse(data.userMatch.events) : []);
      const eventsHtml = events.map(e => {
        const isHome = e.team === 'home';
        const teamName = isHome ? data.userMatch.homeShort : data.userMatch.awayShort;
        const isYou = (isHome && data.userMatch.homeTeamId === state.club?.id) || (!isHome && data.userMatch.awayTeamId === state.club?.id);
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
      const isHome = m.homeTeamId === state.club?.id;
      const userGoals = isHome ? m.homeGoals : m.awayGoals;
      const oppGoals = isHome ? m.awayGoals : m.homeGoals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';

      return `
        <div class="match-list-item" onclick="showMatchReport(${m.id})" style="cursor:pointer">
          <span class="text-muted text-sm" style="min-width:30px">MD${m.matchday}</span>
          <span class="match-list-team">${m.homeName}</span>
          <span class="match-list-score">${m.homeGoals} - ${m.awayGoals}</span>
          <span class="match-list-team">${m.awayName}</span>
          <span class="result-badge result-${result}">${result}</span>
        </div>
      `;
    }).join('');
  } catch (e) { /* silent */ }
}

async function simulateMatch() {
  try {
    // Get user's match to find opponent
    const currentData = await api.get('/matches/current');
    const userMatch = currentData.matches?.find(m =>
      m.homeTeamId === state.club?.id || m.awayTeamId === state.club?.id
    );
    if (!userMatch) {
      showToast('No match to simulate', 'error');
      return;
    }

    const isHome = userMatch.homeTeamId === state.club?.id;
    const homeId = userMatch.homeTeamId;
    const awayId = userMatch.awayTeamId;

    // Get team data for formations and player names
    let homeFormation = '4-4-2';
    let awayFormation = '4-4-2';
    let homePlayers = [];
    let awayPlayers = [];

    try {
      const [homeTactics, awayTactics] = await Promise.all([
        api.get(`/clubs/${homeId}/tactics`).catch(() => null),
        api.get(`/clubs/${awayId}/tactics`).catch(() => null),
      ]);
      if (homeTactics?.tactics?.formation) homeFormation = homeTactics.tactics.formation;
      if (awayTactics?.tactics?.formation) awayFormation = awayTactics.tactics.formation;
      homePlayers = (homeTactics?.players || []).map(p => p.lastName || p.firstName || '');
      awayPlayers = (awayTactics?.players || []).map(p => p.lastName || p.firstName || '');
    } catch (e) { /* use defaults */ }

    // Open match viewer overlay
    openMatchViewer({
      homeName: userMatch.homeName || 'Home',
      awayName: userMatch.awayName || 'Away',
      homeFormation,
      awayFormation,
      homePlayers,
      awayPlayers,
      homeTeamId: homeId,
      awayTeamId: awayId,
    });

    // Simulate on server
    const data = await api.post('/matches/simulate');

    // Get the full match report for events
    let matchEvents = [];
    if (data.userResult) {
      // Find the match ID from results
      const userRes = data.results?.find(r =>
        r.homeTeamId === state.club?.id || r.awayTeamId === state.club?.id
      );
      if (userRes?.matchId) {
        try {
          const report = await api.get(`/matches/report/${userRes.matchId}`);
          matchEvents = report.events || [];
        } catch (e) { /* use empty events */ }
      }
    }

    // Feed events to the match viewer
    feedMatchEvents({
      events: matchEvents,
      homeName: userMatch.homeName || 'Home',
      awayName: userMatch.awayName || 'Away',
      homePlayers,
      awayPlayers,
    });

    // Show result toast when match finishes
    if (data.userResult) {
      const r = data.userResult;
      const userGoals = r.isHome ? r.homeGoals : r.awayGoals;
      const oppGoals = r.isHome ? r.awayGoals : r.homeGoals;
      const result = userGoals > oppGoals ? 'Victory!' : userGoals < oppGoals ? 'Defeat' : 'Draw';
      setTimeout(() => {
        showToast(`${result} ${userGoals} - ${oppGoals}`, userGoals >= oppGoals ? 'success' : 'error');
      }, 2000);
    }

    // Refresh matches page when viewer closes
    matchViewerCloseCallback = () => {
      renderMatches(document.getElementById('main-content'));
    };

  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Match Viewer Integration ──────────────────────────────────────────────
let matchViewerCloseCallback = null;

function openMatchViewer(matchInfo) {
  const overlay = document.getElementById('match-viewer-overlay');
  overlay.style.display = 'flex';

  // Set team names
  document.getElementById('mv-home-name').textContent = matchInfo.homeName;
  document.getElementById('mv-away-name').textContent = matchInfo.awayName;

  // Set team badges (colored circles)
  const homeBadge = document.getElementById('mv-home-badge');
  const awayBadge = document.getElementById('mv-away-badge');
  homeBadge.style.background = 'linear-gradient(135deg, #22a06b, #1a7a5a)';
  awayBadge.style.background = 'linear-gradient(135deg, #4a9eff, #2a6acc)';

  // Reset score
  document.getElementById('mv-home-score').textContent = '0';
  document.getElementById('mv-away-score').textContent = '0';

  // Clear commentary
  document.getElementById('mv-commentary-list').innerHTML = '';

  // Initialize the viewer
  const canvas = document.getElementById('mv-canvas');
  MatchViewer.init(canvas, {
    events: [],
    homeName: matchInfo.homeName,
    awayName: matchInfo.awayName,
    homePlayers: matchInfo.homePlayers,
    awayPlayers: matchInfo.awayPlayers,
  }, matchInfo.homeFormation, matchInfo.awayFormation);

  MatchViewer.start();
}

function feedMatchEvents(matchData) {
  // Re-init with actual events
  const mvState = MatchViewer.getState();
  if (!mvState) return;

  const canvas = document.getElementById('mv-canvas');
  MatchViewer.stop();

  MatchViewer.init(canvas, matchData, mvState.homeFormation, mvState.awayFormation);
  MatchViewer.start();
}

function closeMatchViewer() {
  MatchViewer.stop();
  document.getElementById('match-viewer-overlay').style.display = 'none';
  if (matchViewerCloseCallback) {
    matchViewerCloseCallback();
    matchViewerCloseCallback = null;
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
      const isUser = s.clubId === state.club?.id;
      const isRelegation = s.position > 17;
      return `
        <tr class="${isUser ? 'highlight' : ''} ${isRelegation ? 'relegation' : ''}">
          <td>${s.position}</td>
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
      <div class="page-header">
        <h1 class="page-title">League Table</h1>
        <p class="page-subtitle">Matchday ${data.season.currentMatchday} of ${data.season.totalMatchdays} &middot; ${data.season.status}</p>
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
        <td style="color:var(--text-primary)">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
            ${p.firstName} ${p.lastName}
          </div>
        </td>
        <td>${p.age}</td>
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td class="money">${formatMoney(p.salary)}/w</td>
        <td>${formatMoney(p.value)}</td>
      </tr>
    `).join('');

    const transferRows = data.recentTransfers.slice(0, 10).map(t => `
      <tr>
        <td>MD${t.matchday}</td>
        <td style="color:var(--text-primary)">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(t)}" alt="" loading="lazy">
            ${t.firstName} ${t.lastName}
          </div>
        </td>
        <td>${t.toClubId === state.club?.id ? '<span class="text-green">In</span>' : '<span class="text-red">Out</span>'}</td>
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
          <div class="stat-value green">${formatMoney(data.club.transferBudget)}</div>
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
          <td style="color:var(--text-primary);font-weight:500">
            <div class="player-row-name">
              <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
              ${p.firstName} ${p.lastName}
            </div>
          </td>
          <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
          <td class="text-muted">${p.clubName}</td>
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
          <div class="stat-value">${p.yellowCards}Y ${p.redCards}R</div>
        </div>
      </div>
    `;

    let injuryHtml = '';
    if (p.injuryType) {
      injuryHtml = `
        <div class="card mt-16" style="border-color:var(--red)">
          <div class="card-header">
            <span class="card-title text-red">Injured</span>
          </div>
          <p>${p.injuryType} - ${p.injuryWeeks} week${p.injuryWeeks !== 1 ? 's' : ''} remaining</p>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="page-header">
        <a href="#/squad" class="btn btn-ghost btn-sm mb-16">&larr; Back to Squad</a>
      </div>

      <div class="card">
        <div class="player-detail-header">
          <img class="player-avatar-lg" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
          <div class="player-detail-ovr ${ovrClass(p.ovr)}" style="padding:12px 16px;border-radius:8px;background:var(--bg-input)">${p.ovr}</div>
          <div>
            <div class="player-detail-name">${p.firstName} ${p.lastName}</div>
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
      const isHome = m.homeTeamId === c.id;
      const userGoals = isHome ? m.homeGoals : m.awayGoals;
      const oppGoals = isHome ? m.awayGoals : m.homeGoals;
      const result = userGoals > oppGoals ? 'W' : userGoals < oppGoals ? 'L' : 'D';
      return `
        <div class="match-list-item">
          <span class="text-muted text-sm" style="min-width:30px">MD${m.matchday}</span>
          <span class="match-list-team">${m.homeName}</span>
          <span class="match-list-score">${m.homeGoals} - ${m.awayGoals}</span>
          <span class="match-list-team">${m.awayName}</span>
          <span class="result-badge result-${result}">${result}</span>
        </div>
      `;
    }).join('');

    const topPlayers = data.squad.slice(0, 10).map(p => `
      <tr onclick="showPlayerProfile(${p.id})" style="cursor:pointer">
        <td><span class="ovr-badge ${ovrClass(p.ovr)}">${p.ovr}</span></td>
        <td><span class="pos-badge pos-${p.position}">${p.position}</span></td>
        <td style="color:var(--text-primary)">
          <div class="player-row-name">
            <img class="player-avatar" src="${playerAvatarUrl(p)}" alt="" loading="lazy">
            ${p.firstName} ${p.lastName}
          </div>
        </td>
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
        <td class="text-muted">${pr.team === 'home' ? m.homeShort : m.awayShort}</td>
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
            <div class="match-team-name">${m.homeName}</div>
            <div class="match-team-short">HOME</div>
          </div>
          <div class="match-score">${m.homeGoals} - ${m.awayGoals}</div>
          <div class="match-team">
            <div class="match-team-name">${m.awayName}</div>
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
