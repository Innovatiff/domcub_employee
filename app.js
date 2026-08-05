// ── Auth Guard ──
// Call on every protected page. Redirects to login if not signed in.
function requireAuth(callback) {
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    // Load user profile from Main collection
    db.collection('Main').doc(user.uid).get().then(doc => {
      const profile = doc.exists ? doc.data() : { name: user.email, role: 'manager' };
      window.currentUser = { uid: user.uid, email: user.email, ...profile };
      updateSidebarUser(window.currentUser);
      if (callback) callback(window.currentUser);
    });
  });
}

function updateSidebarUser(user) {
  const el = document.getElementById('sidebarUser');
  if (!el) return;
  el.className = 'sidebar-user';
  el.innerHTML = `
    <div class="avatar" style="width:31px;height:31px;background:${avatarColor(user.name || user.email)}">${initials(user.name || user.email)}</div>
    <div style="overflow:hidden;min-width:0">
      <div style="color:rgba(255,255,255,0.92);font-size:12.5px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${user.name || 'Manager'}</div>
      <div style="color:rgba(255,255,255,0.38);font-size:10.5px;text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${user.role || 'Manager'}</div>
    </div>
  `;
}

function signOut() {
  auth.signOut().then(() => window.location.href = 'login.html');
}

// ── Utilities ──
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function toDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() { return toDateStr(new Date()); }

function formatDate(val) {
  if (!val) return '—';
  const d = new Date(val + (val.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(val) {
  if (!val) return '—';
  const d = new Date(val + (val.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = iso.toDate ? iso.toDate() : new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function calculateHours(clockIn, clockOut) {
  const i = clockIn  && clockIn.toDate  ? clockIn.toDate()  : new Date(clockIn);
  const o = clockOut && clockOut.toDate ? clockOut.toDate() : new Date(clockOut);
  if (!i || !o) return 0;
  return Math.round(((o - i) / 3600000) * 100) / 100;
}

// ── Period Logic (2-week periods anchored Jan 1, 2024) ──
const PERIOD_ORIGIN = new Date('2024-01-01T00:00:00');

function getPeriodIndex(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  const days = Math.floor((d - PERIOD_ORIGIN) / 86400000);
  return Math.floor(days / 14);
}

function getPeriodByIndex(idx) {
  const start = new Date(PERIOD_ORIGIN);
  start.setDate(start.getDate() + idx * 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { index: idx, start: toDateStr(start), end: toDateStr(end) };
}

function getCurrentPeriod() { return getPeriodByIndex(getPeriodIndex(new Date())); }

function formatPeriodLabel(period) {
  const s = new Date(period.start + 'T00:00:00');
  const e = new Date(period.end   + 'T00:00:00');
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}, ${e.getFullYear()}`;
}

// ── Avatar ──
const AVATAR_COLORS = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#0284c7','#be185d'];

function avatarColor(name) {
  let h = 0;
  for (let c of (name || '')) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name) {
  const p = (name || '').trim().split(' ');
  return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : (name||'?').slice(0,2).toUpperCase();
}

function avatarHtml(name, size) {
  const s = size || 34;
  return `<div class="avatar" style="background:${avatarColor(name)};width:${s}px;height:${s}px">${initials(name)}</div>`;
}

// ── Store Filter (UI preference, stays in localStorage) ──
function getSelectedStore() { return localStorage.getItem('domcub_store') || 'all'; }
function setSelectedStore(v) { localStorage.setItem('domcub_store', v); }

// ── Firestore Helpers ──

// Jobs
async function getJobs() {
  const snap = await db.collection('Jobs').orderBy('title').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getJob(id) {
  const doc = await db.collection('Jobs').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function saveJob(data, id) {
  if (id) {
    await db.collection('Jobs').doc(id).update(data);
  } else {
    await db.collection('Jobs').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

async function deleteJob(id) {
  await db.collection('Jobs').doc(id).delete();
}

// Employees
async function getEmployees(store) {
  let q = db.collection('Employees').orderBy('name');
  const snap = await q.get();
  let emps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (store && store !== 'all') emps = emps.filter(e => e.store === store);
  return emps;
}

async function getEmployee(id) {
  const doc = await db.collection('Employees').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function hireEmployee(data) {
  const pin = generatePin();
  const ref = await db.collection('Employees').add({
    ...data,
    pin,
    status: 'active',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, pin };
}

async function updateEmployee(id, data) {
  await db.collection('Employees').doc(id).update(data);
}

// Clock-ins
async function getClockIns(filters) {
  let q = db.collection('ClockIns');
  if (filters && filters.date) q = q.where('date', '==', filters.date);
  if (filters && filters.employeeId) q = q.where('employeeId', '==', filters.employeeId);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getClockInsRange(start, end) {
  const snap = await db.collection('ClockIns')
    .where('date', '>=', start)
    .where('date', '<=', end)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function clockIn(employeeId, store) {
  const now = firebase.firestore.Timestamp.now();
  const ref = await db.collection('ClockIns').add({
    employeeId,
    store,
    clockIn: now,
    clockOut: null,
    date: todayStr(),
    hours: null
  });
  return ref.id;
}

async function clockOut(clockInId) {
  const now = firebase.firestore.Timestamp.now();
  const doc = await db.collection('ClockIns').doc(clockInId).get();
  if (!doc.exists) return;
  const data = doc.data();
  const hours = calculateHours(data.clockIn.toDate(), now.toDate());
  await db.collection('ClockIns').doc(clockInId).update({ clockOut: now, hours });
  return hours;
}

async function getActiveClockIn(employeeId) {
  const snap = await db.collection('ClockIns')
    .where('employeeId', '==', employeeId)
    .where('date', '==', todayStr())
    .where('clockOut', '==', null)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function deleteClockIn(id) {
  await db.collection('ClockIns').doc(id).delete();
}

// Time Off
async function getTimeOff() {
  const snap = await db.collection('TimeOff').orderBy('startDate', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addTimeOff(data) {
  await db.collection('TimeOff').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

async function updateTimeOff(id, data) {
  await db.collection('TimeOff').doc(id).update(data);
}

async function deleteTimeOff(id) {
  await db.collection('TimeOff').doc(id).delete();
}

// Pay Statements
async function getPayStatements(periodStart) {
  let q = db.collection('PayStatements');
  if (periodStart) q = q.where('periodStart', '==', periodStart);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function savePayStatement(data, id) {
  if (id) {
    await db.collection('PayStatements').doc(id).update(data);
  } else {
    await db.collection('PayStatements').add({ ...data, savedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

async function updatePayStatement(id, data) {
  await db.collection('PayStatements').doc(id).update(data);
}

// ── Loading State ──
function skeletonRows(cols, rows) {
  const n = rows || 4;
  let html = '';
  for (let r = 0; r < n; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const w = c === 0 ? '68%' : ['52%','42%','60%','48%'][c % 4];
      html += `<td><div class="skeleton" style="width:${w}"></div></td>`;
    }
    html += '</tr>';
  }
  return html;
}

function skeletonCards(n) {
  return Array.from({ length: n || 4 }, () => `<div class="skeleton-card"></div>`).join('');
}

// ── Toast Notifications ──
function toast(message, type) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const icons = {
    success: 'fa-solid fa-circle-check',
    error:   'fa-solid fa-circle-exclamation',
    info:    'fa-solid fa-circle-info'
  };
  const kind = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<i class="${icons[kind]}"></i><span>${message}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 240);
  }, 3400);
}

// ── Animated Counters ──
// Scans .stat-value elements and counts them up from zero.
function animateValues(scope) {
  const root = scope ? document.getElementById(scope) : document;
  if (!root) return;
  root.querySelectorAll('.stat-value').forEach(el => {
    const raw = el.textContent.trim();
    const match = raw.match(/^(\$?)([\d,]+\.?\d*)(.*)$/);
    if (!match) return;
    const [, prefix, numStr, suffix] = match;
    const target   = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(target)) return;
    const decimals = (numStr.split('.')[1] || '').length;
    const duration = 620;
    const start    = performance.now();

    const step = now => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
      const val = (target * eased).toFixed(decimals);
      el.textContent = prefix + Number(val).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = prefix + (0).toFixed(decimals) + suffix;
    requestAnimationFrame(step);
  });
}

// ── Modal Helpers ──
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Close modals on overlay click and Escape key
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// Track pointer position on buttons so the hover sheen follows the cursor
document.addEventListener('pointermove', e => {
  const btn = e.target.closest && e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${((e.clientX - r.left) / r.width) * 100}%`);
  btn.style.setProperty('--y', `${((e.clientY - r.top) / r.height) * 100}%`);
});
