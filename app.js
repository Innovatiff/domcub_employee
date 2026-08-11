// ══════════════════════════════════════════════════════════
//  El Águila — capa compartida
//  NOTA: los nombres de las colecciones y de los campos se
//  mantienen en inglés (Employees, Jobs, Main, ClockIns,
//  TimeOff, PayStatements, Pedidos, Chats, Messages) para no
//  romper los documentos ya guardados en Firestore.
// ══════════════════════════════════════════════════════════

// ── Tiendas ──
// Los valores '1' y '2' se conservan en la base de datos; sólo
// cambia el nombre que se muestra.
const STORES = {
  '1': { id:'1', name:'Tienda Despensas', short:'Despensas', color:'#b45309', soft:'#fef3c7', icon:'fa-basket-shopping' },
  '2': { id:'2', name:'Tienda Cocina',    short:'Cocina',    color:'#0e7490', soft:'#cffafe', icon:'fa-utensils' }
};
const STORE_IDS = ['1','2'];

function storeName(id)  { return (STORES[id] || {}).name  || '—'; }
function storeShort(id) { return (STORES[id] || {}).short || '—'; }
function storeColor(id) { return (STORES[id] || {}).color || '#667085'; }
function storeIcon(id)  { return (STORES[id] || {}).icon  || 'fa-store'; }

function storeBadge(id) {
  const s = STORES[id];
  if (!s) return '<span class="badge badge-gray">—</span>';
  return `<span class="badge" style="background:${s.soft};color:${s.color}">
    <i class="fa-solid ${s.icon}" style="font-size:9px"></i>${s.short}</span>`;
}

function storeOptions(selected) {
  return STORE_IDS.map(id =>
    `<option value="${id}" ${selected===id?'selected':''}>${STORES[id].name}</option>`).join('');
}

// ── Sesión ──
// Dos tipos de acceso:
//   manager      → correo y contraseña (colección Main)
//   colaborador  → PIN de 6 dígitos (colección Employees) + sesión anónima
let SESSION = null;

function isManager()     { return SESSION && (SESSION.kind === 'manager'); }
function isColaborador() { return SESSION && (SESSION.kind === 'colaborador'); }

function roleLabel(role) {
  return { owner:'Propietario', manager:'Gerente', colaborador:'Colaborador' }[role] || 'Gerente';
}

/**
 * Protege una página.
 * @param {function} callback  se ejecuta con la sesión ya cargada
 * @param {object}   opts      { allow: ['manager','colaborador'] }
 */
function requireAuth(callback, opts) {
  const allow = (opts && opts.allow) || ['manager'];
  auth.onAuthStateChanged(async user => {
    if (!user) { goLogin(); return; }
    try {
      if (user.isAnonymous) {
        // Colaborador identificado por PIN
        const empId = localStorage.getItem('elaguila_emp');
        if (!empId) { goLogin(); return; }
        const emp = await getEmployee(empId);
        if (!emp || emp.status !== 'active') { await auth.signOut(); goLogin(); return; }
        SESSION = {
          kind:'colaborador', pid:'emp:'+emp.id, employeeId:emp.id,
          name:emp.name, role:'colaborador', store:emp.store,
          canPedidos: !!emp.canPedidos
        };
      } else {
        const doc = await db.collection('Main').doc(user.uid).get();
        const p = doc.exists ? doc.data() : { name:user.email, role:'manager' };
        SESSION = {
          kind:'manager', pid:'mgr:'+user.uid, uid:user.uid,
          name:p.name || user.email, role:p.role || 'manager', email:user.email
        };
      }
      // Registra la identidad de esta sesión para que las reglas de
      // Firestore puedan resolver uid -> persona. Sin esto, los chats
      // privados quedan cerrados.
      await registerIdentity(user.uid);

      if (!allow.includes(SESSION.kind)) {
        toast('No tienes acceso a esta sección.', 'error');
        setTimeout(() => window.location.href = isColaborador() ? 'grupo.html' : 'index.html', 900);
        return;
      }
      applyRoleToNav();
      updateSidebarUser(SESSION);
      renderStoreSwitcher();
      if (callback) callback(SESSION);
    } catch (err) {
      console.error('Auth error:', err);
      toast('Error al cargar la sesión: ' + err.message, 'error');
    }
  });
}

function goLogin() {
  if (!/login\.html$/.test(location.pathname)) window.location.href = 'login.html';
}

/**
 * Escribe UserIndex/{uid} = { pid, name, role }.
 * Las reglas de Firestore leen este documento para saber a qué persona
 * pertenece la sesión, y así permitir sólo los chats donde participa.
 * Cada usuario únicamente puede escribir su propio documento.
 */
async function registerIdentity(uid) {
  try {
    if (isManager()) {
      // El pid de gerencia es 'mgr:<uid>', así que se verifica solo:
      // nadie puede escribir un índice con el uid de otra persona.
      await db.collection('UserIndex').doc(uid).set({
        pid: SESSION.pid, name: SESSION.name, role: SESSION.role,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
      return;
    }

    // Colaborador: la prueba de identidad es conocer el PIN.
    // El reclamo se guarda BAJO el PIN (PidClaims/{pin}), de modo que las
    // reglas puedan comprobar contra Pins/{pin} que ese PIN realmente
    // corresponde a este colaborador. Sin el PIN no se puede reclamar.
    const key = localStorage.getItem('elaguila_key');
    if (!key) { await auth.signOut(); goLogin(); return; }

    const claimRef = db.collection('PidClaims').doc(key);
    const claim    = await claimRef.get();
    if (!claim.exists) {
      await claimRef.set({
        uid, employeeId: SESSION.employeeId,
        claimedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else if (claim.data().uid !== uid) {
      // El PIN ya está vinculado a otro dispositivo.
      await claimRef.set({ uid, employeeId: SESSION.employeeId,
        claimedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }

    await db.collection('UserIndex').doc(uid).set({
      pid: SESSION.pid, name: SESSION.name, role: SESSION.role,
      claimKey: key,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  } catch (err) {
    console.error('registerIdentity:', err);
    toast('No se pudo registrar la sesión. El chat privado puede fallar.', 'error');
  }
}

// Oculta del menú lo que un colaborador no debe ver
function applyRoleToNav() {
  if (!isColaborador()) return;
  document.querySelectorAll('.nav-link[data-manager-only]').forEach(a => a.remove());
  document.querySelectorAll('[data-manager-only]').forEach(el => {
    if (!el.classList.contains('nav-link')) el.remove();
  });
  if (!SESSION.canPedidos) {
    document.querySelectorAll('.nav-link[href="pedidos.html"]').forEach(a => a.remove());
  }
  document.querySelectorAll('.nav-section-label').forEach(lbl => {
    let n = lbl.nextElementSibling, count = 0;
    while (n && n.classList.contains('nav-link')) { count++; n = n.nextElementSibling; }
    if (count === 0) lbl.remove();
  });
}

function updateSidebarUser(s) {
  const el = document.getElementById('sidebarUser');
  if (!el || !s) return;
  el.className = 'sidebar-user';
  el.innerHTML = `
    <div class="avatar" style="width:31px;height:31px;background:${avatarColor(s.name)}">${initials(s.name)}</div>
    <div style="overflow:hidden;min-width:0">
      <div class="sidebar-user-name">${s.name || 'Usuario'}</div>
      <div class="sidebar-user-role">${roleLabel(s.role)}</div>
    </div>`;
}

function signOut() {
  localStorage.removeItem('elaguila_emp');
  localStorage.removeItem('elaguila_key');
  auth.signOut().then(() => window.location.href = 'login.html');
}

// ── Selector de tienda ──
// Los colaboradores quedan fijados a su propia tienda.
function getSelectedStore() {
  if (isColaborador()) return SESSION.store;
  return localStorage.getItem('elaguila_store') || 'all';
}
function setSelectedStore(v) { localStorage.setItem('elaguila_store', v); }

function renderStoreSwitcher() {
  const host = document.getElementById('storeSwitcher');
  if (!host) return;
  const cur = getSelectedStore();

  if (isColaborador()) {
    const s = STORES[cur];
    host.innerHTML = `<div class="store-chip locked" style="--sc:${s.color}">
      <i class="fa-solid ${s.icon}"></i><span>${s.name}</span></div>`;
    document.body.setAttribute('data-store', cur);
    return;
  }

  const opts = [{ id:'all', name:'Ambas Tiendas', icon:'fa-layer-group', color:'#4f46e5' }]
    .concat(STORE_IDS.map(id => STORES[id]));

  host.innerHTML = `
    <div class="store-switch-label">Tienda activa</div>
    <div class="store-switch">
      ${opts.map(o => `
        <button class="store-opt ${cur===o.id?'active':''}" style="--sc:${o.color}"
                onclick="switchStore('${o.id}')" title="${o.name}">
          <i class="fa-solid ${o.icon}"></i>
          <span>${o.id==='all' ? 'Ambas' : o.short}</span>
        </button>`).join('')}
    </div>`;
  document.body.setAttribute('data-store', cur);
}

function switchStore(id) {
  setSelectedStore(id);
  renderStoreSwitcher();
  if (typeof onStoreChange === 'function') onStoreChange(id);
  else if (typeof render === 'function') render();
}

// Devuelve una etiqueta legible del alcance actual
function scopeLabel() {
  const s = getSelectedStore();
  return s === 'all' ? 'Ambas Tiendas' : storeName(s);
}

// ── Utilidades ──
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function generatePin() { return String(Math.floor(100000 + Math.random()*900000)); }

function toDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() { return toDateStr(new Date()); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Formato monetario explícito: 1.234.567,89
// No se usa toLocaleString porque en español el CLDR no agrupa los
// números de cuatro cifras (3286 quedaría como "3286"), y en un
// documento contable el separador de miles debe verse siempre.
function money(n) {
  const num = Number(n) || 0;
  const [ent, dec] = Math.abs(num).toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (num < 0 ? '-$' : '$') + miles + ',' + dec;
}

// ── Fechas en español ──
const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS        = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_CORTOS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function parseLocalDate(val) {
  if (!val) return null;
  return new Date(String(val).includes('T') ? val : val + 'T00:00:00');
}

function formatDate(val) {
  const d = parseLocalDate(val);
  if (!d || isNaN(d)) return '—';
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
}
function formatDateShort(val) {
  const d = parseLocalDate(val);
  if (!d || isNaN(d)) return '—';
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}
function formatDateLong(date) {
  const d = new Date(date);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
function formatTime(iso) {
  if (!iso) return '—';
  const d = iso && iso.toDate ? iso.toDate() : new Date(iso);
  if (isNaN(d)) return '—';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2,'0');
  const suf = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${h}:${m} ${suf}`;
}
// "hace 5 min" para el chat
function relativeTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)    return 'ahora';
  if (diff < 3600)  return `hace ${Math.floor(diff/60)} min`;
  if (diff < 86400) return formatTime(d);
  if (diff < 172800) return 'ayer';
  return formatDateShort(toDateStr(d));
}

function calculateHours(clockIn, clockOut) {
  const i = clockIn  && clockIn.toDate  ? clockIn.toDate()  : new Date(clockIn);
  const o = clockOut && clockOut.toDate ? clockOut.toDate() : new Date(clockOut);
  if (!i || !o) return 0;
  return Math.round(((o - i) / 3600000) * 100) / 100;
}

// ── Períodos de pago (quincenales, anclados al 1 de enero de 2024) ──
const PERIOD_ORIGIN = new Date('2024-01-01T00:00:00');

function getPeriodIndex(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  return Math.floor(Math.floor((d - PERIOD_ORIGIN)/86400000) / 14);
}
function getPeriodByIndex(idx) {
  const start = new Date(PERIOD_ORIGIN);
  start.setDate(start.getDate() + idx*14);
  const end = new Date(start); end.setDate(end.getDate()+13);
  return { index: idx, start: toDateStr(start), end: toDateStr(end) };
}
function getCurrentPeriod() { return getPeriodByIndex(getPeriodIndex(new Date())); }
function formatPeriodLabel(p) {
  const s = parseLocalDate(p.start), e = parseLocalDate(p.end);
  return `${s.getDate()} ${MESES_CORTOS[s.getMonth()]} – ${e.getDate()} ${MESES_CORTOS[e.getMonth()]}, ${e.getFullYear()}`;
}

// ── Avatares ──
const AVATAR_COLORS = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#0284c7','#be185d'];
function avatarColor(name) {
  let h = 0;
  for (let c of (name || '')) h = (h*31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name) {
  const p = (name || '').trim().split(' ');
  return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : (name||'?').slice(0,2).toUpperCase();
}
function avatarHtml(name, size) {
  const s = size || 34;
  return `<div class="avatar" style="background:${avatarColor(name)};width:${s}px;height:${s}px">${initials(name)}</div>`;
}

// ══════════════════════════════════════════════════════════
//  Firestore
// ══════════════════════════════════════════════════════════

// Puestos
async function getJobs() {
  const snap = await db.collection('Jobs').orderBy('title').get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function getJob(id) {
  const doc = await db.collection('Jobs').doc(id).get();
  return doc.exists ? { id:doc.id, ...doc.data() } : null;
}
async function saveJob(data, id) {
  if (id) await db.collection('Jobs').doc(id).update(data);
  else    await db.collection('Jobs').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function deleteJob(id) { await db.collection('Jobs').doc(id).delete(); }

// Colaboradores
async function getEmployees(store) {
  const snap = await db.collection('Employees').orderBy('name').get();
  let emps = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  if (store && store !== 'all') emps = emps.filter(e => e.store === store);
  return emps;
}
async function getEmployee(id) {
  const doc = await db.collection('Employees').doc(id).get();
  return doc.exists ? { id:doc.id, ...doc.data() } : null;
}
// El PIN NO se guarda en el documento del colaborador: cualquiera con
// sesión puede leer Employees (lo necesita el chat), así que ahí sólo
// queda información no sensible.
//   Pins/{pin}                  -> { employeeId }   sólo get, nunca list
//   Employees/{id}/secure/pin   -> { pin }          sólo lo lee la gerencia
async function findEmployeeByPin(pin) {
  const doc = await db.collection('Pins').doc(String(pin)).get();
  if (!doc.exists) return null;
  return await getEmployee(doc.data().employeeId);
}

async function getEmployeePin(id) {
  try {
    const d = await db.collection('Employees').doc(id).collection('secure').doc('pin').get();
    return d.exists ? d.data().pin : null;
  } catch { return null; }
}

async function setEmployeePin(id, newPin, oldPin) {
  if (oldPin) { try { await db.collection('Pins').doc(String(oldPin)).delete(); } catch {} }
  await db.collection('Pins').doc(String(newPin)).set({ employeeId: id });
  await db.collection('Employees').doc(id).collection('secure').doc('pin').set({ pin: String(newPin) });
}

async function hireEmployee(data) {
  const pin = data.pin || generatePin();
  const clean = { ...data };
  delete clean.pin;
  const ref = await db.collection('Employees').add({
    ...clean, status:'active',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await setEmployeePin(ref.id, pin);
  return { id:ref.id, pin };
}

async function updateEmployee(id, data) {
  const clean = { ...data };
  delete clean.pin;
  await db.collection('Employees').doc(id).update(clean);
}

// Libera la identidad para que el colaborador pueda entrar en otro equipo
async function releaseIdentity(employeeId) {
  try { await db.collection('PidClaims').doc('emp:' + employeeId).delete(); } catch {}
}

// Entradas y salidas
async function getClockIns(filters) {
  let q = db.collection('ClockIns');
  if (filters && filters.date)       q = q.where('date','==',filters.date);
  if (filters && filters.employeeId) q = q.where('employeeId','==',filters.employeeId);
  const snap = await q.get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function getClockInsRange(start, end) {
  const snap = await db.collection('ClockIns')
    .where('date','>=',start).where('date','<=',end).get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function clockIn(employeeId, store) {
  const now = firebase.firestore.Timestamp.now();
  const ref = await db.collection('ClockIns').add({
    employeeId, store, clockIn:now, clockOut:null, date:todayStr(), hours:null });
  return ref.id;
}
async function clockOut(clockInId) {
  const now = firebase.firestore.Timestamp.now();
  const doc = await db.collection('ClockIns').doc(clockInId).get();
  if (!doc.exists) return;
  const hours = calculateHours(doc.data().clockIn.toDate(), now.toDate());
  await db.collection('ClockIns').doc(clockInId).update({ clockOut:now, hours });
  return hours;
}
async function getActiveClockIn(employeeId) {
  const snap = await db.collection('ClockIns')
    .where('employeeId','==',employeeId).where('date','==',todayStr())
    .where('clockOut','==',null).limit(1).get();
  if (snap.empty) return null;
  return { id:snap.docs[0].id, ...snap.docs[0].data() };
}
async function deleteClockIn(id) { await db.collection('ClockIns').doc(id).delete(); }

// Permisos
// Las reglas sólo dejan a un colaborador leer sus propios permisos, así
// que la consulta debe venir acotada o Firestore la rechaza entera.
// Se ordena en el cliente para no exigir un índice compuesto.
async function getTimeOff() {
  let q = db.collection('TimeOff');
  if (isColaborador()) q = q.where('employeeId','==',SESSION.employeeId);
  const snap = await q.get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(b.startDate||'').localeCompare(String(a.startDate||'')));
}
async function addTimeOff(data) {
  await db.collection('TimeOff').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function updateTimeOff(id, data) { await db.collection('TimeOff').doc(id).update(data); }
async function deleteTimeOff(id) { await db.collection('TimeOff').doc(id).delete(); }

// Nómina
async function getPayStatements(periodStart) {
  let q = db.collection('PayStatements');
  if (periodStart) q = q.where('periodStart','==',periodStart);
  const snap = await q.get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function savePayStatement(data, id) {
  if (id) await db.collection('PayStatements').doc(id).update(data);
  else    await db.collection('PayStatements').add({ ...data, savedAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function updatePayStatement(id, data) { await db.collection('PayStatements').doc(id).update(data); }

// ── Pedidos ──
// Se ordena en el cliente para no exigir índices compuestos en Firestore.
async function getPedidos(store) {
  let q = db.collection('Pedidos');
  if (store && store !== 'all') q = q.where('store','==',store);
  const snap = await q.get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
}
async function getPedido(id) {
  const doc = await db.collection('Pedidos').doc(id).get();
  return doc.exists ? { id:doc.id, ...doc.data() } : null;
}
async function savePedido(data, id) {
  if (id) {
    await db.collection('Pedidos').doc(id).update({
      ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return id;
  }
  const ref = await db.collection('Pedidos').add({
    ...data,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}
async function deletePedido(id) { await db.collection('Pedidos').doc(id).delete(); }

const PEDIDO_ESTADOS = {
  borrador: { label:'Borrador', badge:'badge-gray' },
  enviado:  { label:'Enviado',  badge:'badge-yellow' },
  recibido: { label:'Recibido', badge:'badge-green' }
};

// ── Chat ──
const ANUNCIOS_ID = 'anuncios';

function dmId(a, b) { return 'dm_' + [a,b].sort().join('__'); }

async function ensureDm(meP, otherP, names) {
  const id = dmId(meP, otherP);
  const ref = db.collection('Chats').doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({
      type:'dm', participants:[meP, otherP], names:names || {},
      lastMessage:'', lastAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  return id;
}

async function ensureAnuncios() {
  const ref = db.collection('Chats').doc(ANUNCIOS_ID);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ type:'anuncios', participants:[], names:{},
      lastMessage:'', lastAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  return ANUNCIOS_ID;
}

async function sendMessage(chatId, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  await db.collection('Messages').add({
    chatId,
    senderId:   SESSION.pid,
    senderName: SESSION.name,
    senderRole: SESSION.role,
    text: clean,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('Chats').doc(chatId).set({
    lastMessage: clean.slice(0,80),
    lastAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
}

// Escucha en vivo. Se ordena en el cliente para evitar índices compuestos.
function listenMessages(chatId, cb) {
  return db.collection('Messages').where('chatId','==',chatId)
    .onSnapshot(snap => {
      const msgs = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        .sort((a,b) => {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return ta - tb;
        });
      cb(msgs);
    }, err => { console.error('listenMessages:', err); toast('Error en el chat: '+err.message,'error'); });
}

// Igual que arriba: escuchar toda la colección Chats se rechaza, porque
// las reglas limitan la lectura a las conversaciones propias. Se abren
// dos escuchas: las mías, y el canal de anuncios (que es público).
function listenChats(cb) {
  const state = { mine: [], anuncios: null };
  const emit = () => cb(state.anuncios ? state.mine.concat([state.anuncios]) : state.mine);

  const unsubMine = db.collection('Chats')
    .where('participants','array-contains', SESSION.pid)
    .onSnapshot(snap => {
      state.mine = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      emit();
    }, err => console.error('listenChats(mine):', err));

  const unsubAnuncios = db.collection('Chats').doc(ANUNCIOS_ID)
    .onSnapshot(doc => {
      state.anuncios = doc.exists ? { id:doc.id, ...doc.data() } : null;
      emit();
    }, err => console.error('listenChats(anuncios):', err));

  return () => { unsubMine(); unsubAnuncios(); };
}

// ── Estados de carga ──
function skeletonRows(cols, rows) {
  let html = '';
  for (let r = 0; r < (rows||4); r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const w = c === 0 ? '68%' : ['52%','42%','60%','48%'][c%4];
      html += `<td><div class="skeleton" style="width:${w}"></div></td>`;
    }
    html += '</tr>';
  }
  return html;
}
function skeletonCards(n) {
  return Array.from({ length:n||4 }, () => '<div class="skeleton-card"></div>').join('');
}

// ── Notificaciones ──
function toast(message, type) {
  let host = document.querySelector('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  const icons = { success:'fa-solid fa-circle-check', error:'fa-solid fa-circle-exclamation', info:'fa-solid fa-circle-info' };
  const kind = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<i class="${icons[kind]}"></i><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 240); }, 3400);
}

// ── Contadores animados ──
function animateValues(scope) {
  const root = scope ? document.getElementById(scope) : document;
  if (!root) return;
  root.querySelectorAll('.stat-value').forEach(el => {
    const m = el.textContent.trim().match(/^(\$?)([\d.,]+)(.*)$/);
    if (!m) return;
    const [, prefix, numStr, suffix] = m;
    const target = parseFloat(numStr.replace(/\./g,'').replace(',','.').replace(/,/g,''));
    if (isNaN(target)) return;
    const decimals = (numStr.split(/[.,]/)[1] || '').length > 0 && numStr.includes(',') ? 2 : (numStr.split('.')[1]||'').length;
    const dur = 620, start = performance.now();
    const step = now => {
      const p = Math.min((now-start)/dur, 1);
      const v = target * (1 - Math.pow(1-p, 3));
      el.textContent = prefix + v.toLocaleString('es', { minimumFractionDigits:decimals, maximumFractionDigits:decimals }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = prefix + (0).toFixed(decimals) + suffix;
    requestAnimationFrame(step);
  });
}

// ── Modales ──
function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});
document.addEventListener('pointermove', e => {
  const btn = e.target.closest && e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${((e.clientX-r.left)/r.width)*100}%`);
  btn.style.setProperty('--y', `${((e.clientY-r.top)/r.height)*100}%`);
});
