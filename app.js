// ── Storage Helpers ──
function getDB(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function setDB(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Keys ──
const KEYS = {
  jobs: 'domcub_jobs',
  employees: 'domcub_employees',
  clockins: 'domcub_clockins',
  periods: 'domcub_periods',
  paystatements: 'domcub_paystatements',
  timeoff: 'domcub_timeoff'
};

// ── Date / Time Helpers ──
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function toDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() { return toDateStr(new Date()); }

function calculateHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0;
  const diff = (new Date(clockOut) - new Date(clockIn)) / 3600000;
  return Math.round(diff * 100) / 100;
}

// ── Period Logic (2-week periods starting Jan 1, 2024) ──
const PERIOD_ORIGIN = new Date('2024-01-01');

function getPeriodIndex(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const origin = new Date(PERIOD_ORIGIN);
  const days = Math.floor((d - origin) / 86400000);
  return Math.floor(days / 14);
}

function getPeriodByIndex(idx) {
  const start = new Date(PERIOD_ORIGIN);
  start.setDate(start.getDate() + idx * 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { index: idx, start: toDateStr(start), end: toDateStr(end) };
}

function getCurrentPeriod() {
  return getPeriodByIndex(getPeriodIndex(new Date()));
}

function getPeriodByDate(date) {
  return getPeriodByIndex(getPeriodIndex(date));
}

function formatPeriodLabel(period) {
  const s = new Date(period.start + 'T00:00:00');
  const e = new Date(period.end + 'T00:00:00');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const yr = e.getFullYear();
  return `${fmt(s)} – ${fmt(e)}, ${yr}`;
}

// ── Avatar Colors ──
const AVATAR_COLORS = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#0284c7','#be185d'];
function avatarColor(name) {
  let h = 0;
  for (let c of (name||'')) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name) {
  const parts = (name || '').trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
    : (name || '?').slice(0, 2).toUpperCase();
}

function avatarHtml(name, size) {
  const s = size || 34;
  return `<div class="avatar" style="background:${avatarColor(name)};width:${s}px;height:${s}px">${initials(name)}</div>`;
}

// ── CRUD ──
// Jobs
function getJobs() { return getDB(KEYS.jobs); }
function saveJobs(j) { setDB(KEYS.jobs, j); }
function getJob(id) { return getJobs().find(j => j.id === id); }

// Employees
function getEmployees(store) {
  const all = getDB(KEYS.employees);
  if (!store || store === 'all') return all;
  return all.filter(e => e.store === store);
}
function saveEmployees(e) { setDB(KEYS.employees, e); }
function getEmployee(id) { return getDB(KEYS.employees).find(e => e.id === id); }

// Clock-ins
function getClockIns() { return getDB(KEYS.clockins); }
function saveClockIns(c) { setDB(KEYS.clockins, c); }

function clockInEmployee(employeeId, store) {
  const cis = getClockIns();
  const now = new Date().toISOString();
  cis.push({ id: generateId(), employeeId, clockIn: now, clockOut: null, date: todayStr(), store });
  saveClockIns(cis);
}

function clockOutEmployee(employeeId) {
  const cis = getClockIns();
  const entry = cis.slice().reverse().find(c => c.employeeId === employeeId && !c.clockOut);
  if (entry) {
    const now = new Date().toISOString();
    entry.clockOut = now;
    entry.hours = calculateHours(entry.clockIn, entry.clockOut);
    saveClockIns(cis);
    return entry;
  }
  return null;
}

function isClocked(employeeId) {
  return getClockIns().slice().reverse().find(c => c.employeeId === employeeId && !c.clockOut) || null;
}

function getHoursForPeriod(employeeId, period) {
  return getClockIns().filter(c =>
    c.employeeId === employeeId &&
    c.clockOut &&
    c.date >= period.start &&
    c.date <= period.end
  );
}

function getTotalHoursForPeriod(employeeId, period) {
  return getHoursForPeriod(employeeId, period).reduce((s, c) => s + (c.hours || 0), 0);
}

// Time off
function getTimeOff() { return getDB(KEYS.timeoff); }
function saveTimeOff(t) { setDB(KEYS.timeoff, t); }

// Pay statements
function getPayStatements() { return getDB(KEYS.paystatements); }
function savePayStatements(p) { setDB(KEYS.paystatements, p); }

// ── Sidebar store filter ──
function getSelectedStore() {
  return localStorage.getItem('domcub_store') || 'all';
}
function setSelectedStore(val) {
  localStorage.setItem('domcub_store', val);
}

// ── Seed Demo Data ──
function seedDemoData() {
  if (getDB(KEYS.jobs).length > 0) return;

  const jobs = [
    { id: 'j1', title: 'Store Manager',      department: 'Management', color: '#4f46e5' },
    { id: 'j2', title: 'Sales Associate',    department: 'Sales',      color: '#059669' },
    { id: 'j3', title: 'Tech Repair Spec.',  department: 'Tech',       color: '#0891b2' },
    { id: 'j4', title: 'Cashier',            department: 'Operations', color: '#d97706' },
    { id: 'j5', title: 'Inventory Clerk',    department: 'Operations', color: '#7c3aed' },
  ];
  saveJobs(jobs);

  const employees = [
    { id: 'e1', name: 'Carlos Reyes',      jobId: 'j1', store: '1', status: 'active', hireDate: '2022-03-15', hourlyRate: 22, phone: '(787) 555-0101', email: 'carlos@domcub.com' },
    { id: 'e2', name: 'Maria Santos',      jobId: 'j2', store: '1', status: 'active', hireDate: '2023-01-10', hourlyRate: 16, phone: '(787) 555-0102', email: 'maria@domcub.com' },
    { id: 'e3', name: 'Luis Fernandez',    jobId: 'j3', store: '1', status: 'active', hireDate: '2023-06-20', hourlyRate: 18, phone: '(787) 555-0103', email: 'luis@domcub.com' },
    { id: 'e4', name: 'Ana Rodriguez',     jobId: 'j4', store: '1', status: 'active', hireDate: '2024-02-01', hourlyRate: 15, phone: '(787) 555-0104', email: 'ana@domcub.com' },
    { id: 'e5', name: 'Diego Morales',     jobId: 'j1', store: '2', status: 'active', hireDate: '2022-08-05', hourlyRate: 22, phone: '(787) 555-0201', email: 'diego@domcub.com' },
    { id: 'e6', name: 'Sofia Perez',       jobId: 'j2', store: '2', status: 'active', hireDate: '2023-04-18', hourlyRate: 16, phone: '(787) 555-0202', email: 'sofia@domcub.com' },
    { id: 'e7', name: 'Miguel Torres',     jobId: 'j3', store: '2', status: 'active', hireDate: '2023-09-12', hourlyRate: 18, phone: '(787) 555-0203', email: 'miguel@domcub.com' },
    { id: 'e8', name: 'Isabella Cruz',     jobId: 'j5', store: '2', status: 'active', hireDate: '2024-05-07', hourlyRate: 15, phone: '(787) 555-0204', email: 'isabella@domcub.com' },
  ];
  saveEmployees(employees);

  // Seed some clock-in data for current and previous period
  const cur = getCurrentPeriod();
  const prev = getPeriodByIndex(getPeriodIndex(new Date()) - 1);
  const clockins = [];

  const workDays = (period) => {
    const days = [];
    let d = new Date(period.start + 'T00:00:00');
    const end = new Date(period.end + 'T00:00:00');
    while (d <= end) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) days.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return days;
  };

  const addShifts = (period, empIds) => {
    workDays(period).forEach(dateStr => {
      if (dateStr >= todayStr()) return;
      empIds.forEach(eid => {
        const hr = 8 + Math.floor(Math.random() * 2);
        const clockIn = new Date(`${dateStr}T0${hr}:00:00`);
        const shiftLen = 7 + Math.random() * 2;
        const clockOut = new Date(clockIn.getTime() + shiftLen * 3600000);
        const hours = calculateHours(clockIn.toISOString(), clockOut.toISOString());
        clockins.push({ id: generateId(), employeeId: eid, clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString(), date: dateStr, store: employees.find(e=>e.id===eid).store, hours });
      });
    });
  };

  addShifts(prev, ['e1','e2','e3','e4','e5','e6','e7','e8']);
  addShifts(cur,  ['e1','e2','e3','e4','e5','e6','e7','e8']);

  // Clock in e1 and e5 right now (no clockOut)
  const nowIso = new Date().toISOString();
  clockins.push({ id: generateId(), employeeId: 'e1', clockIn: nowIso, clockOut: null, date: todayStr(), store: '1', hours: null });
  clockins.push({ id: generateId(), employeeId: 'e5', clockIn: nowIso, clockOut: null, date: todayStr(), store: '2', hours: null });

  saveClockIns(clockins);

  // Seed time off
  const today = new Date();
  const m = today.getMonth();
  const y = today.getFullYear();
  const pad = n => String(n).padStart(2,'0');
  const timeoff = [
    { id: generateId(), employeeId: 'e2', startDate: `${y}-${pad(m+1)}-${pad(10)}`, endDate: `${y}-${pad(m+1)}-${pad(12)}`, type: 'vacation', status: 'approved', note: 'Family trip' },
    { id: generateId(), employeeId: 'e4', startDate: `${y}-${pad(m+1)}-${pad(18)}`, endDate: `${y}-${pad(m+1)}-${pad(18)}`, type: 'sick', status: 'pending', note: 'Doctor appointment' },
    { id: generateId(), employeeId: 'e6', startDate: `${y}-${pad(m+1)}-${pad(22)}`, endDate: `${y}-${pad(m+1)}-${pad(25)}`, type: 'personal', status: 'approved', note: '' },
  ];
  saveTimeOff(timeoff);
}

// Init
seedDemoData();
