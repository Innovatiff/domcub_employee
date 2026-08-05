// ── Guardia de Autenticación ──
// Se llama en cada página protegida. Redirige al login si no hay sesión.
function requireAuth(callback) {
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    // Carga el perfil del usuario desde la colección Main
    db.collection('Main').doc(user.uid).get().then(doc => {
      const profile = doc.exists ? doc.data() : { name: user.email, role: 'manager' };
      window.currentUser = { uid: user.uid, email: user.email, ...profile };
      updateSidebarUser(window.currentUser);
      if (callback) callback(window.currentUser);
    });
  });
}

// Traduce el rol guardado en Firestore a su etiqueta en español
function roleLabel(role) {
  return { owner: 'Propietario', manager: 'Gerente' }[role] || 'Gerente';
}

function updateSidebarUser(user) {
  const el = document.getElementById('sidebarUser');
  if (!el) return;
  el.className = 'sidebar-user';
  el.innerHTML = `
    <div class="avatar" style="width:31px;height:31px;background:${avatarColor(user.name || user.email)}">${initials(user.name || user.email)}</div>
    <div style="overflow:hidden;min-width:0">
      <div style="color:rgba(255,255,255,0.92);font-size:12.5px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${user.name || 'Gerente'}</div>
      <div style="color:rgba(255,255,255,0.38);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${roleLabel(user.role)}</div>
    </div>
  `;
}

function signOut() {
  auth.signOut().then(() => window.location.href = 'login.html');
}

// ── Utilidades ──
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

// ── Nombres en Español ──
const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CORTOS = ['ene','feb','mar','abr','may','jun',
                      'jul','ago','sep','oct','nov','dic'];
const DIAS       = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_CORTOS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function parseLocalDate(val) {
  if (!val) return null;
  return new Date(String(val).includes('T') ? val : val + 'T00:00:00');
}

// 5 ago 2026
function formatDate(val) {
  const d = parseLocalDate(val);
  if (!d || isNaN(d)) return '—';
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
}

// 5 ago
function formatDateShort(val) {
  const d = parseLocalDate(val);
  if (!d || isNaN(d)) return '—';
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

// miércoles, 5 de agosto de 2026
function formatDateLong(date) {
  const d = new Date(date);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// 8:30 a. m.
function formatTime(iso) {
  if (!iso) return '—';
  const d = iso.toDate ? iso.toDate() : new Date(iso);
  if (isNaN(d)) return '—';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${h}:${m} ${sufijo}`;
}

function calculateHours(clockIn, clockOut) {
  const i = clockIn  && clockIn.toDate  ? clockIn.toDate()  : new Date(clockIn);
  const o = clockOut && clockOut.toDate ? clockOut.toDate() : new Date(clockOut);
  if (!i || !o) return 0;
  return Math.round(((o - i) / 3600000) * 100) / 100;
}

// ── Períodos de Pago (quincenales, anclados al 1 de enero de 2024) ──
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

// 1 ago – 14 ago, 2026
function formatPeriodLabel(period) {
  const s = parseLocalDate(period.start);
  const e = parseLocalDate(period.end);
  return `${s.getDate()} ${MESES_CORTOS[s.getMonth()]} – ${e.getDate()} ${MESES_CORTOS[e.getMonth()]}, ${e.getFullYear()}`;
}

// ── Avatares ──
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

// ── Filtro de Tienda (preferencia de interfaz) ──
function getSelectedStore() { return localStorage.getItem('elaguila_store') || 'all'; }
function setSelectedStore(v) { localStorage.setItem('elaguila_store', v); }

// ══════════════════════════════════════════════════════════
//  Firestore
//  NOTA: los nombres de las colecciones se mantienen en inglés
//  (Employees, Jobs, Main, ClockIns, TimeOff, PayStatements)
//  para no romper los datos ya guardados.
// ══════════════════════════════════════════════════════════

// Puestos
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

// Empleados
async function getEmployees(store) {
  const snap = await db.collection('Employees').orderBy('name').get();
  let emps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (store && store !== 'all') emps = emps.filter(e => e.store === store);
  return emps;
}

async function getEmployee(id) {
  const doc = await db.collection('Employees').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function hireEmployee(data) {
  const pin = data.pin || generatePin();
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

// Registros de entrada/salida
async function getClockIns(filters) {
  let q = db.collection('ClockIns');
  if (filters && filters.date)       q = q.where('date', '==', filters.date);
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
    employeeId, store,
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
  const data  = doc.data();
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

// Permisos / Tiempo libre
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

// Nómina
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

// ── Estados de Carga ──
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

// ── Notificaciones ──
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

// ── Contadores Animados ──
// Recorre los .stat-value y los anima desde cero.
function animateValues(scope) {
  const root = scope ? document.getElementById(scope) : document;
  if (!root) return;
  root.querySelectorAll('.stat-value').forEach(el => {
    const raw = el.textContent.trim();
    const match = raw.match(/^(\$?)([\d,]+\.?\d*)(.*)$/);
    if (!match) return;
    const [, prefix, numStr, suffix] = match;
    const target = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(target)) return;
    const decimals = (numStr.split('.')[1] || '').length;
    const duration = 620;
    const start    = performance.now();

    const step = now => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
      const val = (target * eased).toFixed(decimals);
      el.textContent = prefix + Number(val).toLocaleString('es', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = prefix + (0).toFixed(decimals) + suffix;
    requestAnimationFrame(step);
  });
}

// ── Modales ──
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Cerrar modales al hacer clic fuera o con la tecla Escape
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

// Sigue el cursor sobre los botones para el brillo del hover
document.addEventListener('pointermove', e => {
  const btn = e.target.closest && e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${((e.clientX - r.left) / r.width) * 100}%`);
  btn.style.setProperty('--y', `${((e.clientY - r.top) / r.height) * 100}%`);
});
