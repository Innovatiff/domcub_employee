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
  '1': { id:'1', name:'Tienda Despensas', short:'Despensas', color:'#b45309', soft:'#fef3c7', icon:'basket-outline' },
  '2': { id:'2', name:'Tienda Cocina',    short:'Cocina',    color:'#0e7490', soft:'#cffafe', icon:'restaurant-outline' }
};
const STORE_IDS = ['1','2'];

function storeName(id)  { return (STORES[id] || {}).name  || '—'; }
function storeShort(id) { return (STORES[id] || {}).short || '—'; }
function storeColor(id) { return (STORES[id] || {}).color || '#667085'; }
function storeIcon(id)  { return (STORES[id] || {}).icon  || 'storefront-outline'; }

function storeBadge(id) {
  const s = STORES[id];
  if (!s) return '<span class="badge badge-gray">—</span>';
  return `<span class="badge" style="background:${s.soft};color:${s.color}">
    <ion-icon name="${s.icon}" style="font-size:10px"></ion-icon>${s.short}</span>`;
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
        const ref = db.collection('Main').doc(user.uid);
        const doc = await ref.get();
        let p;
        if (doc.exists) {
          p = doc.data();
        } else {
          // Las cuentas de gerencia se crean directamente en Firebase, así
          // que la primera vez no existe la ficha. Se crea aquí; sin ella
          // la persona no aparecería en la lista del chat.
          p = { name: (user.email || '').split('@')[0], email: user.email, role: 'manager' };
          await ref.set({ ...p, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
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
      restaurarNav();
      updateSidebarUser(SESSION);
      renderStoreSwitcher();
      mountNotifications();
      setupPush();
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
  // Un grupo que se queda sin enlaces no tiene por qué seguir ahí
  document.querySelectorAll('.nav-group').forEach(g => {
    if (!g.querySelector('.nav-link')) g.remove();
  });
}

/**
 * Secciones plegables del menú. Se recuerda cuáles quedaron cerradas, de
 * modo que el menú se vea igual al cambiar de página; y la sección de la
 * página actual se abre siempre, para no dejarte sin ver dónde estás.
 */
const NAV_CERRADOS = 'elaguila_nav_cerrado';

function navCerrados() {
  try { return JSON.parse(localStorage.getItem(NAV_CERRADOS) || '[]'); }
  catch (e) { return []; }
}

function toggleNavGroup(btn) {
  const g = btn.closest('.nav-group');
  const cerrar = !g.classList.contains('cerrado');
  g.classList.toggle('cerrado', cerrar);
  btn.setAttribute('aria-expanded', String(!cerrar));

  const lista = navCerrados().filter(x => x !== g.dataset.group);
  if (cerrar) lista.push(g.dataset.group);
  try { localStorage.setItem(NAV_CERRADOS, JSON.stringify(lista)); } catch (e) {}
}

function restaurarNav() {
  const cerrados = navCerrados();
  document.querySelectorAll('.nav-group').forEach(g => {
    // La sección donde estás nunca arranca cerrada
    const aqui = g.querySelector('.nav-link.active');
    const cerrado = !aqui && cerrados.includes(g.dataset.group);
    g.classList.toggle('cerrado', cerrado);
    const btn = g.querySelector('.nav-group-head');
    if (btn) btn.setAttribute('aria-expanded', String(!cerrado));
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
  const v = localStorage.getItem('elaguila_store');
  // 'all' ya no existe como opción; quien lo tuviera guardado cae en
  // Despensas. Cada página muestra una tienda o la otra, nunca las dos.
  return (v === '1' || v === '2') ? v : '1';
}
function setSelectedStore(v) { localStorage.setItem('elaguila_store', v); }

function renderStoreSwitcher() {
  const host = document.getElementById('storeSwitcher');
  if (!host) return;
  const cur = getSelectedStore();

  if (isColaborador()) {
    const s = STORES[cur];
    host.innerHTML = `<div class="store-chip locked" style="--sc:${s.color}">${s.name}</div>`;
    document.body.setAttribute('data-store', cur);
    return;
  }

  const opts = STORE_IDS.map(id => STORES[id]);

  host.innerHTML = `
    <div class="store-switch-label">Tienda activa</div>
    <div class="store-switch">
      ${opts.map(o => `
        <button class="store-opt ${cur===o.id?'active':''}" style="--sc:${o.color}"
                onclick="switchStore('${o.id}')" title="${o.name}">${o.short}</button>`).join('')}
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
/**
 * Número en español: miles con punto, decimales con coma.
 *
 * Se agrupa a mano porque el CLDR español no separa los miles en cifras de
 * cuatro dígitos —3286 se quedaría en "3286"— y en una nómina eso se lee
 * mal justo en el rango donde caen casi todos los importes.
 */
function agrupaES(n, dec = 2) {
  const num = Number(n) || 0;
  const [ent, d] = Math.abs(num).toFixed(dec).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (num < 0 ? '-' : '') + miles + (dec ? ',' + d : '');
}

function money(n)            { const v = Number(n) || 0;
                               return (v < 0 ? '-$' : '$') + agrupaES(Math.abs(v), 2); }
function numES(n, dec = 1)   { return agrupaES(n, dec); }

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
function getPeriodByStart(start) { return getPeriodByIndex(getPeriodIndex(parseLocalDate(start))); }
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
  if (oldPin) {
    try { await db.collection('Pins').doc(String(oldPin)).delete(); } catch (e) {}
    // Y su reclamo, o el aparato viejo seguiría teniendo identidad válida
    await releaseIdentity(oldPin);
  }
  await db.collection('Pins').doc(String(newPin)).set({ employeeId: id });
  await db.collection('Employees').doc(id).collection('secure').doc('pin').set({ pin: String(newPin) });
}

// Crea la cuenta de acceso al portal del colaborador.
// Se usa una segunda instancia de Firebase para que la gerencia NO pierda
// su propia sesión al registrar a otra persona.
async function createPortalAccount(email, password, employeeId) {
  const name = 'alta-' + Date.now();
  const app2 = firebase.initializeApp(firebase.app().options, name);
  try {
    const cred = await app2.auth().createUserWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;
    await app2.auth().signOut();
    // El vínculo uid -> colaborador es lo que las reglas usan para saber
    // que esta cuenta NO es de gerencia.
    await db.collection('Colaboradores').doc(uid).set({
      employeeId, email: email.toLowerCase(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { uid };
  } finally {
    await app2.delete();
  }
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

  // Si se capturó un correo, se le crea el acceso al portal usando el PIN
  // como contraseña inicial. El colaborador la cambia al entrar.
  let portal = null;
  if (clean.email) {
    try {
      const { uid } = await createPortalAccount(clean.email, pin, ref.id);
      await db.collection('Employees').doc(ref.id).update({ authUid: uid, portalReady: true });
      portal = 'ok';
    } catch (err) {
      console.error('createPortalAccount:', err);
      portal = err.code === 'auth/email-already-in-use' ? 'duplicado'
             : err.code === 'auth/invalid-email'        ? 'correo-invalido'
             : 'error';
    }
  }
  return { id:ref.id, pin, portal };
}

async function updateEmployee(id, data) {
  const clean = { ...data };
  delete clean.pin;
  await db.collection('Employees').doc(id).update(clean);
}

/**
 * Migración única de los colaboradores dados de alta antes de los cambios.
 *
 * Arregla dos cosas que no puede arreglar ni el reloj ni el portal:
 *
 *  1. El PIN. Antes vivía dentro del documento del colaborador y no
 *     existía Pins/{pin}. Sin ese documento las reglas no dejan que el
 *     reloj cree su reclamo de identidad, así que el colaborador pasa la
 *     pantalla del PIN pero no puede marcar entrada.
 *
 *  2. La cuenta del portal. Sólo se crea al contratar, así que quien ya
 *     estaba en la plantilla no tiene con qué entrar.
 *
 * Ambas cosas requieren permisos de gerencia, por eso viven aquí.
 * Es idempotente: correrla dos veces no hace daño.
 */
async function pendingMigration() {
  const snap = await db.collection('Employees').get();
  const emps = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  return {
    pin:   emps.filter(e => e.pin),                                            // el PIN sigue en el documento
    portal: emps.filter(e => e.status === 'active' && e.email && !e.authUid),   // sin cuenta de portal
    todos: emps
  };
}

async function migrateAll(onProgress) {
  const pend = await pendingMigration();

  // Una sola instancia secundaria para todas las altas, de modo que la
  // gerencia no pierda su propia sesión al crear cuentas ajenas.
  const app2 = firebase.initializeApp(firebase.app().options, 'mig-' + Date.now());
  const res  = { pinOk:0, pinFail:0, ctaOk:0, ctaExiste:0, ctaFail:0, sinCorreo:0, ctaOtraClave:[] };

  // Lista de trabajo: unión de los dos conjuntos, sin repetir
  const ids = [...new Set([...pend.pin, ...pend.portal].map(e => e.id))];
  const byId = {}; pend.todos.forEach(e => byId[e.id] = e);

  try {
    let hecho = 0;
    for (const id of ids) {
      const e = byId[id];

      // ── 1. PIN ──
      let pin = e.pin || null;
      if (e.pin) {
        try {
          await setEmployeePin(id, e.pin);
          await db.collection('Employees').doc(id).update({
            pin: firebase.firestore.FieldValue.delete()
          });
          res.pinOk++;
        } catch (err) { console.error('migrar PIN', id, err); res.pinFail++; }
      }
      // Si ya se había migrado, el PIN está en la subcolección
      if (!pin) pin = await getEmployeePin(id);

      // ── 2. Cuenta del portal ──
      if (e.status === 'active' && e.email && !e.authUid) {
        if (!pin) { res.ctaFail++; }
        else {
          try {
            const cred = await app2.auth().createUserWithEmailAndPassword(e.email, pin);
            await vincularCuenta(app2, cred.user.uid, id, e.email);
            res.ctaOk++;
          } catch (err) {
            if (err.code === 'auth/email-already-in-use') {
              // La cuenta ya existía (quizá de un intento anterior a medias).
              // Se entra con el PIN para averiguar el uid y terminar el vínculo.
              try {
                const cred = await app2.auth().signInWithEmailAndPassword(e.email, pin);
                await vincularCuenta(app2, cred.user.uid, id, e.email);
                res.ctaExiste++;
              } catch (e2) {
                // El correo ya tiene cuenta pero con OTRA contraseña, así que
                // no hay forma de averiguar su uid desde aquí. La única salida
                // es borrar ese usuario en la consola de Firebase y repetir.
                if (e2.code === 'auth/invalid-login-credentials' ||
                    e2.code === 'auth/wrong-password' ||
                    e2.code === 'auth/user-not-found') {
                  res.ctaOtraClave.push(e.email);
                } else {
                  console.error('vincular existente', id, e2);
                }
                res.ctaFail++;
              }
            } else {
              console.error('crear cuenta', id, err); res.ctaFail++;
            }
          }
        }
      } else if (e.status === 'active' && !e.email && !e.authUid) {
        res.sinCorreo++;
      }

      hecho++;
      if (onProgress) onProgress(hecho, ids.length);
    }
  } finally {
    try { await app2.auth().signOut(); } catch (e) {}
    await app2.delete();
  }
  return res;
}

async function vincularCuenta(app2, uid, employeeId, email) {
  await app2.auth().signOut();
  await db.collection('Colaboradores').doc(uid).set({
    employeeId, email: String(email).toLowerCase(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('Employees').doc(employeeId).update({ authUid: uid, portalReady: true });
}

/**
 * Suelta el reclamo de un PIN que deja de valer.
 *
 * Los reclamos se guardan bajo el PIN —PidClaims/{pin}—, no bajo el
 * identificador del colaborador. Esto borraba 'emp:<id>', un documento que
 * no existe en ninguna parte, así que no hacía nada: al cambiarle el PIN a
 * alguien, el reclamo viejo se quedaba ahí.
 */
async function releaseIdentity(pin) {
  if (!pin) return;
  try { await db.collection('PidClaims').doc(String(pin)).delete(); } catch (e) {}
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
/**
 * El turno abierto de un colaborador, sea de hoy o de otro día.
 *
 * Antes esto exigía que la marca fuera de hoy, y ahí estaba el problema:
 * quien olvidaba marcar salida quedaba con un turno abierto invisible: al
 * día siguiente el reloj no lo veía, abría otro, y el primero se quedaba
 * sin cerrar para siempre. Un turno sin cerrar no tiene horas, así que esas
 * horas no entraban en la nómina y nadie se enteraba.
 */
async function getActiveClockIn(employeeId) {
  const snap = await db.collection('ClockIns')
    .where('employeeId','==',employeeId).where('clockOut','==',null).get();
  if (snap.empty) return null;
  const abiertos = snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
  return abiertos[0];
}

/** Todos los turnos sin cerrar. Sólo la gerencia puede consultarlos. */
async function getOpenClockIns() {
  const snap = await db.collection('ClockIns').where('clockOut','==',null).get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')));
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
async function deletePayStatement(id) { await db.collection('PayStatements').doc(id).delete(); }

/**
 * Arma los recibos de un período a partir de las marcas de entrada.
 *
 * Sólo cuenta los turnos cerrados: uno abierto todavía no tiene horas, y
 * meterlo daría un recibo que cambia solo. Se rehacen los recibos del
 * período, pero conservando lo ya pagado —marcar pagado es una decisión de
 * la gerencia y no se pierde porque se vuelva a generar—.
 */
async function generarNomina(periodStart) {
  const p = getPeriodByStart(periodStart);
  const [emps, marcas, previos] = await Promise.all([
    getEmployees(),
    getClockInsRange(p.start, p.end),
    getPayStatements(p.start)
  ]);

  const activos = emps.filter(e => e.status === 'active');
  const horasPor = {};
  marcas.filter(m => m.clockOut && m.hours).forEach(m => {
    horasPor[m.employeeId] = (horasPor[m.employeeId] || 0) + Number(m.hours || 0);
  });

  const antes = {};
  previos.forEach(s => { antes[s.employeeId] = s; });

  const res = { creados: 0, actualizados: 0, sinHoras: 0, conservados: 0 };

  for (const e of activos) {
    const horas = Math.round((horasPor[e.id] || 0) * 100) / 100;
    const viejo = antes[e.id];
    delete antes[e.id];

    if (!horas) { res.sinHoras++; if (!viejo) continue; }

    // Un recibo ya pagado no se toca: reescribirlo cambiaría el importe de
    // algo que ya salió de la caja.
    if (viejo && viejo.status === 'paid') { res.conservados++; continue; }

    const rate = Number(e.hourlyRate || 0);
    const datos = {
      employeeId: e.id, employeeName: e.name, store: e.store,
      periodStart: p.start, periodEnd: p.end,
      hours: horas, rate, gross: Math.round(horas * rate * 100) / 100,
      status: 'pending', paidDate: null
    };
    if (viejo) { await updatePayStatement(viejo.id, datos); res.actualizados++; }
    else if (horas)  { await savePayStatement(datos); res.creados++; }
  }

  // Recibos de gente que ya no está activa, y sin pagar: sobran
  for (const id in antes) {
    const s = antes[id];
    if (s.status !== 'paid') await deletePayStatement(s.id);
  }
  return res;
}

// ══ Horario semanal ══
//
// Un documento por semana y tienda: Horarios/{lunes}_{tienda} =
//   { weekStart, store, shifts: { empId: { 'YYYY-MM-DD': {in,out} } } }
//
// Un solo documento por semana hace que copiar la semana anterior, leerla
// entera o pintarla sea una única operación, y con dos tiendas y un puñado
// de colaboradores nunca se acerca al límite de tamaño.

/** El lunes de la semana a la que pertenece la fecha. */
function lunesDe(fecha) {
  const d = fecha instanceof Date ? new Date(fecha) : parseLocalDate(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // getDay(): domingo=0
  return toDateStr(d);
}

function diasDeSemana(lunes) {
  const base = parseLocalDate(lunes);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(d.getDate() + i);
    return toDateStr(d);
  });
}

async function getHorario(lunes, store) {
  const doc = await db.collection('Horarios').doc(`${lunes}_${store}`).get();
  return doc.exists ? doc.data() : { weekStart: lunes, store, shifts: {} };
}

async function saveHorario(lunes, store, shifts) {
  await db.collection('Horarios').doc(`${lunes}_${store}`).set({
    weekStart: lunes, store, shifts,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Borra los turnos de un colaborador entre dos fechas, en ambas tiendas.
 *
 * Es lo que engancha los permisos con el horario: al aprobarse uno, la
 * persona sale sola de los días concedidos, sin que la gerencia tenga que
 * acordarse de ir a la página del horario a quitarla.
 */
async function quitarDelHorario(employeeId, desde, hasta) {
  const semanas = new Set();
  let d = parseLocalDate(desde);
  const fin = parseLocalDate(hasta);
  while (d <= fin) { semanas.add(lunesDe(d)); d = new Date(d); d.setDate(d.getDate() + 7); }
  semanas.add(lunesDe(fin));

  let quitados = 0;
  for (const lunes of semanas) {
    for (const store of STORE_IDS) {
      const ref = db.collection('Horarios').doc(`${lunes}_${store}`);
      const doc = await ref.get();
      if (!doc.exists) continue;
      const shifts = doc.data().shifts || {};
      const mios = shifts[employeeId];
      if (!mios) continue;
      let cambio = false;
      for (const fecha of Object.keys(mios)) {
        if (fecha >= desde && fecha <= hasta) { delete mios[fecha]; cambio = true; quitados++; }
      }
      if (cambio) {
        if (!Object.keys(mios).length) delete shifts[employeeId];
        await ref.set({ ...doc.data(), shifts,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
    }
  }
  return quitados;
}

/** Permisos aprobados que caen dentro de una semana, por colaborador. */
async function permisosDeSemana(lunes) {
  const dias = diasDeSemana(lunes);
  const snap = await db.collection('TimeOff')
    .where('status', '==', 'approved').get();
  const porEmp = {};
  snap.docs.map(d => d.data())
    .filter(t => t.startDate <= dias[6] && t.endDate >= dias[0])
    .forEach(t => {
      (porEmp[t.employeeId] = porEmp[t.employeeId] || []).push(t);
    });
  return porEmp;
}

// ══ Registros de viaje (kilometraje a las farmacias) ══
//
// Un documento por viaje:
//   Registros/{id} = { employeeId, employeeName, store, vehiculo, date,
//                      kmSalida, horaSalida, kmLlegada, horaLlegada,
//                      km, minutos, status: 'en-ruta' | 'completado' }
//
// El viaje se abre al salir y se cierra al llegar; mientras tanto queda
// 'en-ruta', que es lo que permite el botón de un toque para la llegada.

async function getRegistros(filtros) {
  let q = db.collection('Registros');
  if (filtros && filtros.employeeId) q = q.where('employeeId', '==', filtros.employeeId);
  else if (filtros && filtros.store) q = q.where('store', '==', filtros.store);
  const snap = await q.get();
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Fechas en el cliente: rango + igualdad exigiría índice compuesto
  if (filtros && filtros.desde) rows = rows.filter(r => r.date >= filtros.desde);
  if (filtros && filtros.hasta) rows = rows.filter(r => r.date <= filtros.hasta);
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))
    || millisRegistro(b.horaSalida) - millisRegistro(a.horaSalida));
}

function millisRegistro(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }

/** El viaje abierto de un colaborador, si lo hay. */
async function registroAbierto(employeeId) {
  const snap = await db.collection('Registros')
    .where('employeeId', '==', employeeId)
    .where('status', '==', 'en-ruta').get();
  if (snap.empty) return null;
  const abiertos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => millisRegistro(b.horaSalida) - millisRegistro(a.horaSalida));
  return abiertos[0];
}

/**
 * Dónde quedó el cuentakilómetros de un vehículo la última vez.
 * Es la automatización que evita teclear: el kilometraje de salida de hoy
 * es casi siempre el de llegada de ayer.
 */
async function ultimoKmDe(vehiculo, store) {
  const regs = await getRegistros({ store });
  const del = regs.filter(r => r.vehiculo === vehiculo && r.status === 'completado' && r.kmLlegada);
  return del.length ? del[0].kmLlegada : null;
}

/** Vehículos ya usados en la tienda, para no teclearlos dos veces. */
async function vehiculosDe(store) {
  const regs = await getRegistros({ store });
  return [...new Set(regs.map(r => (r.vehiculo || '').trim()).filter(Boolean))];
}

async function abrirViaje(datos) {
  const ref = await db.collection('Registros').add({
    ...datos, status: 'en-ruta',
    kmLlegada: null, horaLlegada: null, km: null, minutos: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function cerrarViaje(id, kmLlegada, horaLlegada) {
  const doc = await db.collection('Registros').doc(id).get();
  if (!doc.exists) throw new Error('Ese viaje ya no existe');
  const r = doc.data();
  const km = Math.round((kmLlegada - r.kmSalida) * 10) / 10;
  const minutos = r.horaSalida && horaLlegada
    ? Math.max(0, Math.round((horaLlegada.toMillis() - r.horaSalida.toMillis()) / 60000))
    : null;
  await db.collection('Registros').doc(id).update({
    kmLlegada, horaLlegada, km, minutos, status: 'completado'
  });
  return { km, minutos };
}

async function deleteRegistro(id) { await db.collection('Registros').doc(id).delete(); }

function duracionLabel(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

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

/**
 * Reduce la foto antes de subirla.
 *
 * Una foto de teléfono ronda los 4 MB y por datos móviles eso son varios
 * segundos de espera. Se redibuja a 1200 px de lado mayor con calidad 0,68,
 * que deja el archivo en unos 90 KB: en una burbuja de chat no se nota la
 * diferencia, y un papel o una etiqueta fotografiada de cerca se siguen
 * leyendo. Es el punto donde la espera desaparece sin que la foto deje de
 * servir para lo que se usa.
 */
/** Nunca deja una promesa colgada: si tarda de más, se rinde. */
function conTiempo(promesa, ms, queHacia) {
  return Promise.race([
    promesa,
    new Promise((_, fail) => setTimeout(
      () => fail(new Error('Se agotó el tiempo ' + queHacia)), ms))
  ]);
}

function aBlob(canvas, calidad) {
  return new Promise((ok, fail) => {
    if (!canvas.toBlob) {
      // Safari antiguo: se arma el blob a mano desde el data URL
      try {
        const s = canvas.toDataURL('image/jpeg', calidad).split(',')[1];
        const bin = atob(s);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return ok(new Blob([buf], { type: 'image/jpeg' }));
      } catch (e) { return fail(e); }
    }
    canvas.toBlob(b => b ? ok(b) : fail(new Error('El navegador no pudo comprimir la imagen')),
                  'image/jpeg', calidad);
  });
}

/**
 * Reduce la foto antes de subirla.
 *
 * En iPhone esto es lo delicado. Una foto de la cámara son 12 megapíxeles;
 * descodificarla ya cuesta, y Safari además limita el tamaño de los lienzos
 * y a veces deja `toBlob` sin responder. Por eso:
 *
 *   · se descodifica UNA sola vez —medir y reescalar en dos pasadas
 *     duplicaba el trabajo, que es lo que la dejaba clavada—;
 *   · todo va con tiempo máximo, para que nunca quede una promesa colgada;
 *   · si algo falla, quien llama sube la foto original en vez de rendirse.
 */
async function encogerImagen(file, maxLado = 1200, calidad = 0.68) {
  const dibujar = (fuente, anchoO, altoO) => {
    const e = Math.min(1, maxLado / Math.max(anchoO, altoO));
    const w = Math.max(1, Math.round(anchoO * e));
    const h = Math.max(1, Math.round(altoO * e));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(fuente, 0, 0, w, h);
    return { c, w, h };
  };

  if (typeof createImageBitmap === 'function') {
    let bmp = null;
    try {
      bmp = await conTiempo(createImageBitmap(file), 15000, 'al abrir la foto');
      const { c, w, h } = dibujar(bmp, bmp.width, bmp.height);
      const blob = await conTiempo(aBlob(c, calidad), 15000, 'al comprimir la foto');
      return { blob, w, h };
    } catch (e) {
      console.warn('createImageBitmap no sirvió, se prueba con <img>:', e);
    } finally {
      if (bmp && bmp.close) bmp.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await conTiempo(new Promise((ok, fail) => {
      const i = new Image();
      i.onload  = () => ok(i);
      i.onerror = () => fail(new Error('El navegador no pudo abrir esa imagen'));
      i.src = url;
    }), 15000, 'al abrir la foto');

    const { c, w, h } = dibujar(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    const blob = await conTiempo(aBlob(c, calidad), 15000, 'al comprimir la foto');
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MAX_FOTO = 12 * 1024 * 1024;   // lo que llega del teléfono, antes de encoger

async function enviarFoto(chatId, file, onProgreso) {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Sólo se pueden enviar imágenes');
  }
  if (file.size > MAX_FOTO)            throw new Error('La imagen es demasiado grande');

  // Encoger ocurre ANTES de que empiece la subida. Sin avisar de esta fase
  // el porcentaje se queda en cero y parece colgado.
  if (onProgreso) onProgreso(null);

  // Si reducirla falla —Safari con una foto enorme, un formato que no sabe
  // dibujar— se sube tal cual. Tarda más, pero la foto llega, que es lo que
  // importa. Quedarse sin enviar nada sería el peor resultado.
  let blob, w = 0, h = 0;
  try {
    ({ blob, w, h } = await encogerImagen(file));
  } catch (e) {
    console.warn('No se pudo reducir la foto, se sube original:', e);
    blob = file;
  }

  const nombre = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
  const ref = firebase.storage().ref(`chat/${chatId}/${nombre}`);

  // Con el porcentaje a la vista la espera se hace corta; sin él, cualquier
  // segundo parece que se colgó.
  // Si hubo que subir el original, su tipo puede no ser JPEG (iPhone manda
  // HEIC); declararlo mal haría que no se viera.
  const tarea = ref.put(blob, { contentType: blob.type || 'image/jpeg' });
  await new Promise((ok, fail) => {
    tarea.on('state_changed',
      s => { if (onProgreso && s.totalBytes) onProgreso(Math.round(s.bytesTransferred / s.totalBytes * 100)); },
      fail, ok);
  });
  const url = await ref.getDownloadURL();

  await db.collection('Messages').add({
    chatId,
    senderId:   SESSION.pid,
    senderName: SESSION.name,
    senderRole: SESSION.role,
    type: 'image', url, w, h, text: '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('Chats').doc(chatId).set({
    lastMessage: 'Foto',
    lastSender:  SESSION.pid,
    lastAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
}

function dmId(a, b) { return 'dm_' + [a,b].sort().join('__'); }

async function ensureDm(meP, otherP, names) {
  const id = dmId(meP, otherP);
  // Ojo: NO se puede consultar antes si existe. Las reglas resuelven la
  // lectura de un chat mirando `resource.data.participants`, y en un
  // documento que todavía no existe `resource` es nulo, así que la lectura
  // se deniega y la conversación nunca llegaba a crearse. Se escribe
  // directamente con merge, que sirve igual para crear que para actualizar.
  // Sólo se tocan los campos estables, para no borrar el último mensaje.
  await db.collection('Chats').doc(id).set({
    type:'dm', participants:[meP, otherP], names:names || {}
  }, { merge:true });
  return id;
}

async function ensureAnuncios() {
  // Mismo motivo que en ensureDm: se escribe sin consultar antes.
  await db.collection('Chats').doc(ANUNCIOS_ID)
    .set({ type:'anuncios', participants:[], names:{} }, { merge:true });
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
    lastSender:  SESSION.pid,   // para no avisarte de tus propios mensajes
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

// ══ Avisos de mensajes nuevos ══
//
// Qué se considera "no leído": el chat tiene un último mensaje más reciente
// que la última vez que abrí ese chat, y no lo escribí yo. La marca de
// lectura se guarda en este equipo (localStorage) por dos razones: no hace
// falta tocar las reglas, y "leído" es realmente por dispositivo.

function readKey() { return 'elaguila_leido_' + (SESSION ? SESSION.pid : 'anon'); }

function readMap() {
  try { return JSON.parse(localStorage.getItem(readKey()) || '{}'); }
  catch (e) { return {}; }
}
function markChatRead(chatId) {
  const m = readMap();
  m[chatId] = Date.now();
  try { localStorage.setItem(readKey(), JSON.stringify(m)); } catch (e) {}
  if (window.refreshNotifBadge) window.refreshNotifBadge();
}
function millisOf(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }

function unreadChats(chats) {
  const leido = readMap();
  return chats.filter(c => {
    const t = millisOf(c.lastAt);
    if (!t) return false;
    if (c.lastSender === SESSION.pid) return false;   // lo escribí yo
    return t > (leido[c.id] || 0);
  }).sort((a,b) => millisOf(b.lastAt) - millisOf(a.lastAt));
}

// ══ Visto y reacciones ══
//
// "Visto" se comparte: al abrir una conversación se anota la hora en el
// documento del chat (Chats/{id}.vistos[miPid]) y así el que envió ve el
// "Visto" bajo su mensaje. La marca local de arriba sigue mandando para
// la campana; esta es sólo para el otro lado.

const vistoEscrito = {};   // anti-bucle: escribir dispara el snapshot, que
                           // vuelve a llamar aquí; sólo se escribe si hay
                           // algo más nuevo que la última escritura.
function marcarVisto(chatId, lastAtMs) {
  if (!SESSION) return;
  const t = lastAtMs || Date.now();
  if (vistoEscrito[chatId] && vistoEscrito[chatId] >= t) return;
  vistoEscrito[chatId] = t;
  const campo = {}; campo['vistos.' + SESSION.pid] = firebase.firestore.FieldValue.serverTimestamp();
  db.collection('Chats').doc(chatId).update(campo)
    .catch(e => console.warn('marcarVisto:', e));
}

const REACCION = { up:'👍', love:'❤️', down:'👎' };

// Poner, cambiar o quitar (si ya era la misma) la reacción propia.
async function reaccionar(msgId, tipo, actual) {
  const campo = {};
  campo['reacciones.' + SESSION.pid] =
    actual === tipo ? firebase.firestore.FieldValue.delete() : tipo;
  await db.collection('Messages').doc(msgId).update(campo);
}

/**
 * Coloca la campana de avisos arriba de cada página. Se inyecta desde aquí
 * para que exista en todas sin tener que tocar cada HTML.
 */
function mountNotifications() {
  const main = document.querySelector('main.main');
  if (!main || document.getElementById('notifBar')) return;
  // En la página del chat sobra: ahí se ven los avisos en la propia lista.
  if (/grupo\.html$/.test(location.pathname)) return;

  const bar = document.createElement('div');
  bar.className = 'notif-bar';
  bar.id = 'notifBar';
  bar.innerHTML = `
    <button class="notif-btn" id="notifBtn" title="Avisos" aria-label="Avisos">
      <ion-icon name="notifications-outline"></ion-icon>
      <span class="notif-dot" id="notifDot" hidden></span>
    </button>
    <div class="notif-panel" id="notifPanel" hidden>
      <div class="notif-panel-head">Avisos</div>
      <div id="notifPanelBody"></div>
    </div>`;
  main.insertBefore(bar, main.firstChild);

  let ultimos = [];

  document.getElementById('notifBtn').onclick = e => {
    e.stopPropagation();
    const p = document.getElementById('notifPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) pintarPanel();
  };
  document.addEventListener('click', e => {
    const p = document.getElementById('notifPanel');
    if (p && !p.hidden && !bar.contains(e.target)) p.hidden = true;
  });

  function pintarPanel() {
    const body = document.getElementById('notifPanelBody');
    if (!ultimos.length) {
      body.innerHTML = `<div class="notif-empty">
        <ion-icon name="notifications-off-outline"></ion-icon>
        <div>Nada nuevo por ahora</div></div>`;
      return;
    }
    body.innerHTML = ultimos.map(c => {
      const quien = c.id === ANUNCIOS_ID
        ? 'Anuncios Generales'
        : ((c.names && c.names[c.lastSender]) || 'Mensaje nuevo');
      return `<a class="notif-item" href="grupo.html?chat=${encodeURIComponent(c.id)}">
        <div class="notif-item-icon">${c.id === ANUNCIOS_ID
          ? '<ion-icon name="megaphone-outline"></ion-icon>'
          : '<ion-icon name="chatbubble-outline"></ion-icon>'}</div>
        <div style="min-width:0;flex:1">
          <div class="notif-item-name">${escapeHtml(quien)}</div>
          <div class="notif-item-text">${escapeHtml(c.lastMessage || 'Mensaje nuevo')}</div>
        </div>
        <div class="notif-item-time">${c.lastAt ? relativeTime(c.lastAt) : ''}</div>
      </a>`;
    }).join('');
  }

  function pintarBadge() {
    const dot = document.getElementById('notifDot');
    const btn = document.getElementById('notifBtn');
    if (!dot) return;
    dot.hidden = ultimos.length === 0;
    dot.textContent = ultimos.length > 9 ? '9+' : String(ultimos.length);
    btn.classList.toggle('has-news', ultimos.length > 0);
    const p = document.getElementById('notifPanel');
    if (p && !p.hidden) pintarPanel();
  }

  let todos = [];
  window.refreshNotifBadge = () => { ultimos = unreadChats(todos); pintarBadge(); };

  listenChats(list => {
    todos  = list;
    const antes = ultimos.length;
    ultimos = unreadChats(list);
    pintarBadge();
    // Aviso emergente sólo cuando llega algo mientras la página está abierta,
    // y no en la propia página del chat, que ya lo muestra.
    if (ultimos.length > antes && !/grupo\.html$/.test(location.pathname)) {
      const c = ultimos[0];
      const quien = c.id === ANUNCIOS_ID
        ? 'Anuncios Generales'
        : ((c.names && c.names[c.lastSender]) || 'un compañero');
      toast('Nuevo mensaje de ' + quien, 'success');
    }
  });
}

// ══ Notificaciones con la app cerrada (Firebase Cloud Messaging) ══
//
// Los avisos de arriba sólo existen mientras la página está abierta. Para
// que llegue algo con la pestaña cerrada hace falta una push de verdad:
//
//   1. este equipo pide permiso al navegador y obtiene un token
//   2. el token se guarda en PushTokens/{token} = { pid }
//   3. al escribirse un mensaje, una Cloud Function busca los tokens de
//      los destinatarios y les manda la push
//
// El envío no puede hacerse desde aquí: requiere una credencial de
// servidor, y en el código de la página cualquiera podría leerla.

function pushDisponible() {
  return typeof VAPID_KEY === 'string' && VAPID_KEY
      && 'serviceWorker' in navigator
      && 'Notification' in window
      && typeof firebase.messaging === 'function';
}

// El SDK de mensajería no está en todas las páginas, así que se trae sólo
// cuando de verdad se va a usar.
function cargarSdkMensajeria() {
  if (window.__msgSdk) return window.__msgSdk;
  window.__msgSdk = new Promise((ok, fail) => {
    if (firebase.messaging) return ok();
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js';
    s.onload = () => ok();
    s.onerror = () => fail(new Error('No se pudo cargar el SDK de mensajería'));
    document.head.appendChild(s);
  });
  return window.__msgSdk;
}

async function guardarToken(token) {
  await db.collection('PushTokens').doc(token).set({
    pid: SESSION.pid,
    name: SESSION.name,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
}

/**
 * Pide permiso, registra el dispositivo y deja escuchando los avisos que
 * lleguen con la página abierta. Devuelve true si quedó activo.
 */
async function activarPush() {
  try {
    await cargarSdkMensajeria();
    if (!pushDisponible()) return false;

    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      if (permiso === 'denied') {
        toast('Los avisos están bloqueados en este navegador. Actívalos en el candado de la barra de direcciones.', 'error');
      }
      return false;
    }

    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    const messaging = firebase.messaging();
    const token = await messaging.getToken({
      vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return false;

    await guardarToken(token);

    // Con la página abierta el navegador NO muestra la push; llega aquí.
    // La campana ya avisa por su cuenta, así que sólo se escucha para no
    // perder nada si la escucha en vivo estuviera caída.
    messaging.onMessage(payload => {
      const n = payload.notification || {};
      if (n.title) toast(n.title + ': ' + (n.body || 'mensaje nuevo'), 'success');
    });
    return true;
  } catch (err) {
    console.error('activarPush:', err);
    return false;
  }
}

/**
 * Si ya se dio permiso alguna vez, se renueva el token en silencio (cambia
 * al reinstalar o al limpiar el navegador). Si no, se ofrece un botón:
 * pedir el permiso de golpe al entrar es justo lo que la gente rechaza.
 */
async function setupPush() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') { activarPush(); return; }
  if (Notification.permission === 'denied')  return;
  if (localStorage.getItem('elaguila_push_no')) return;

  const bar = document.getElementById('notifBar');
  if (!bar) return;
  const btn = document.createElement('button');
  btn.className = 'push-ask';
  btn.innerHTML = '<ion-icon name="notifications-outline"></ion-icon> Activar avisos';
  btn.title = 'Recibir un aviso aunque tengas la página cerrada';
  btn.onclick = async () => {
    btn.disabled = true;
    const ok = await activarPush();
    if (ok) { toast('Avisos activados en este equipo', 'success'); btn.remove(); }
    else { btn.disabled = false; localStorage.setItem('elaguila_push_no', '1'); }
  };
  bar.insertBefore(btn, bar.firstChild);
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
  const icons = { success:'checkmark-circle-outline', error:'alert-circle-outline', info:'information-circle-outline' };
  const kind = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<ion-icon name="${icons[kind]}"></ion-icon><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 240); }, 3400);
}

// ── Contadores animados ──
/**
 * Anima los números de las tarjetas.
 *
 * Lee lo que ya está escrito, así que TIENE que interpretarlo en el mismo
 * formato en que se escribe: español, punto para los miles y coma para los
 * decimales. Antes daba por hecho que el punto siempre era de miles, y
 * "$1234.56" acababa mostrándose como "$123.456,00" —cien veces más—.
 * Por eso todas las cifras se escriben ya con money() o numES().
 */
function animateValues(scope) {
  const root = scope ? document.getElementById(scope) : document;
  if (!root) return;
  root.querySelectorAll('.stat-value').forEach(el => {
    const m = el.textContent.trim().match(/^([^\d-]*)(-?[\d.,]+)(.*)$/);
    if (!m) return;
    const [, prefix, numStr, suffix] = m;
    const target = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
    if (isNaN(target)) return;
    const decimals = (numStr.split(',')[1] || '').length;
    const dur = 620, start = performance.now();
    const step = now => {
      const p = Math.min((now-start)/dur, 1);
      const v = target * (1 - Math.pow(1-p, 3));
      el.textContent = prefix + agrupaES(v, decimals) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = prefix + agrupaES(0, decimals) + suffix;
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

// ══════════════════════════════════════════════════════════
//  Tareas (checklists por tienda)
//
//  Tareas/{id} es la plantilla: qué hay que hacer y qué días. Lo hecho de
//  cada día vive aparte en TareasHechas/{tareaId_fecha}, así la plantilla
//  nunca se ensucia y el historial de cada día queda guardado.
// ══════════════════════════════════════════════════════════

async function getTareas(store) {
  const snap = await db.collection('Tareas').where('store','==',store).get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(a.titulo||'').localeCompare(String(b.titulo||'')));
}

async function saveTarea(id, data) {
  if (id) await db.collection('Tareas').doc(id).update(data);
  else    await db.collection('Tareas').add({ ...data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

async function deleteTarea(id) { await db.collection('Tareas').doc(id).delete(); }

// ¿Toca hoy? Sin días marcados aplica todos los días.
function tareaAplicaHoy(t, dow) {
  const d = dow === undefined ? new Date().getDay() : dow;
  return !Array.isArray(t.dias) || !t.dias.length || t.dias.includes(d);
}

// Lo hecho de un día: mapa tareaId -> { hechos: {indice: {nombre, at}} }
async function getHechosDe(date, store) {
  const snap = await db.collection('TareasHechas')
    .where('date','==',date).where('store','==',store).get();
  const por = {};
  snap.docs.forEach(d => { por[d.data().tareaId] = { id:d.id, ...d.data() }; });
  return por;
}

// Marcar o desmarcar un renglón. El documento del día se crea solo.
async function marcarItem(tareaId, date, store, idx, hecho) {
  const quien = hecho
    ? { nombre: SESSION.name, pid: SESSION.pid, at: Date.now() }
    : firebase.firestore.FieldValue.delete();
  await db.collection('TareasHechas').doc(tareaId + '_' + date).set({
    tareaId, date, store, hechos: { [idx]: quien }
  }, { merge:true });
}

// ══════════════════════════════════════════════════════════
//  Notas de desempeño (privadas de la gerencia)
// ══════════════════════════════════════════════════════════

const NOTA_TIPOS = {
  positivo:  { label:'Reconocimiento', icon:'star-outline',          color:'var(--success)', soft:'var(--success-soft)' },
  incidente: { label:'Incidente',      icon:'alert-circle-outline',  color:'var(--danger)',  soft:'var(--danger-soft)' },
  tarde:     { label:'Llegada tarde',  icon:'time-outline',          color:'var(--warning)', soft:'var(--warning-soft)' },
  nota:      { label:'Nota',           icon:'document-text-outline', color:'var(--info)',    soft:'var(--info-soft)' },
};

async function getNotas(empId) {
  const snap = await db.collection('NotasPersonal').where('employeeId','==',empId).get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
}

async function addNota(empId, tipo, texto, date) {
  await db.collection('NotasPersonal').add({
    employeeId: empId, tipo, texto, date,
    por: SESSION.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteNota(id) { await db.collection('NotasPersonal').doc(id).delete(); }

// ══════════════════════════════════════════════════════════
//  Cumpleaños y aniversarios
// ══════════════════════════════════════════════════════════

// Próximos eventos del equipo en los siguientes `dias` días (incluye hoy).
// Devuelve [{emp, tipo:'cumple'|'aniversario', fecha:'YYYY-MM-DD', en, anos}]
function proximosEventos(emps, dias = 30) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const out = [];
  const siguiente = iso => {
    // La próxima vez que caiga ese mes/día (maneja el año bisiesto: 29/2
    // en año normal cae el 28/2).
    const [ , m, d ] = String(iso).split('-').map(Number);
    if (!m || !d) return null;
    for (let y = hoy.getFullYear(); y <= hoy.getFullYear()+1; y++) {
      const f = new Date(y, m-1, Math.min(d, new Date(y, m, 0).getDate()));
      if (f >= hoy) return f;
    }
    return null;
  };
  emps.filter(e => e.status === 'active').forEach(e => {
    [['cumple', e.birthday], ['aniversario', e.hireDate]].forEach(([tipo, iso]) => {
      if (!iso) return;
      const f = siguiente(iso);
      if (!f) return;
      const en = Math.round((f - hoy) / 86400000);
      if (en > dias) return;
      const anos = f.getFullYear() - Number(String(iso).slice(0,4));
      if (tipo === 'aniversario' && anos < 1) return;   // recién contratado
      out.push({ emp:e, tipo, fecha: toDateStr(f), en, anos });
    });
  });
  return out.sort((a,b) => a.en - b.en);
}

// ══════════════════════════════════════════════════════════
//  Reportes de incidentes (con foto)
// ══════════════════════════════════════════════════════════

async function getReportes() {
  const snap = await db.collection('Reportes').get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
}

// Crear un reporte; si trae foto se reduce y se sube primero.
async function crearReporte({ texto, store, file }, onProgreso) {
  let foto = null, w = 0, h = 0;
  if (file) {
    if (file.type && !file.type.startsWith('image/')) throw new Error('Sólo se pueden adjuntar imágenes');
    if (file.size > 12 * 1024 * 1024) throw new Error('La imagen es demasiado grande');
    if (onProgreso) onProgreso(null);
    let blob;
    try { ({ blob, w, h } = await encogerImagen(file)); }
    catch (e) { console.warn('se sube original:', e); blob = file; }
    const nombre = `${Date.now()}_${Math.random().toString(36).slice(2,9)}.jpg`;
    const ref = firebase.storage().ref(`reportes/${nombre}`);
    const tarea = ref.put(blob, { contentType: blob.type || 'image/jpeg' });
    await new Promise((ok, fail) => {
      tarea.on('state_changed',
        s => { if (onProgreso && s.totalBytes) onProgreso(Math.round(s.bytesTransferred/s.totalBytes*100)); },
        fail, ok);
    });
    foto = await ref.getDownloadURL();
  }
  await db.collection('Reportes').add({
    por: SESSION.pid, nombre: SESSION.name, store,
    texto: String(texto||'').trim(), foto, w, h,
    date: todayStr(), status: 'nuevo',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function marcarReporteVisto(id) {
  await db.collection('Reportes').doc(id).update({
    status: 'revisado', revisadoPor: SESSION.name,
    revisadoAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteReporte(id) { await db.collection('Reportes').doc(id).delete(); }
