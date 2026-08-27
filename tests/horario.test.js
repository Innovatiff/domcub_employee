// Prueba de la lógica del horario, sin navegador ni Firestore.
// Se ejecuta con:  node tests/horario.test.js
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname,'..','app.js'), 'utf8');
const trozo = (a,b) => src.slice(src.indexOf(a), src.indexOf(b));

const toDateStr = d => { const x=new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const parseLocalDate = v => new Date(String(v).includes('T') ? v : v+'T00:00:00');
const STORE_IDS = ['1','2'];

// Firestore de mentira
let DOCS = {};
const db = { collection: c => ({ doc: id => ({
  get: async () => ({ exists: !!DOCS[c+'/'+id], data: () => DOCS[c+'/'+id] }),
  set: async d => { DOCS[c+'/'+id] = JSON.parse(JSON.stringify(d)); }
}), where: () => ({ get: async () => ({ docs: [] }) }) }) };
const firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };

const code = trozo('/** El lunes de la semana', '/** Permisos aprobados');
const api = new Function('toDateStr','parseLocalDate','STORE_IDS','db','firebase',
  code + '\nreturn { lunesDe, diasDeSemana, getHorario, saveHorario, quitarDelHorario };')(
  toDateStr, parseLocalDate, STORE_IDS, db, firebase);

let fallos = 0;
const ok = (c, q) => { console.log((c?'  ok   ':'  FALLA')+'  '+q); if(!c) fallos++; };

(async () => {
  // lunesDe en todos los días de la semana
  ok(api.lunesDe('2026-08-12') === '2026-08-10', 'miércoles 12 ago -> lunes 10');
  ok(api.lunesDe('2026-08-10') === '2026-08-10', 'un lunes es su propio lunes');
  ok(api.lunesDe('2026-08-16') === '2026-08-10', 'domingo 16 pertenece a la semana del 10');
  ok(api.lunesDe('2026-08-17') === '2026-08-17', 'lunes 17 arranca semana nueva');

  const dias = api.diasDeSemana('2026-08-10');
  ok(dias.length === 7 && dias[0] === '2026-08-10' && dias[6] === '2026-08-16',
     'la semana va de lunes a domingo');

  // quitarDelHorario respeta fechas y tiendas
  DOCS = {
    'Horarios/2026-08-10_1': { weekStart:'2026-08-10', store:'1', shifts: {
      ana:  { '2026-08-11': {in:'09:00',out:'17:00'}, '2026-08-13': {in:'09:00',out:'17:00'} },
      beto: { '2026-08-11': {in:'12:00',out:'20:00'} }
    }},
    'Horarios/2026-08-17_1': { weekStart:'2026-08-17', store:'1', shifts: {
      ana: { '2026-08-18': {in:'09:00',out:'17:00'} }
    }}
  };
  // Permiso de Ana del 12 al 18: cruza dos semanas
  const n = await api.quitarDelHorario('ana', '2026-08-12', '2026-08-18');
  ok(n === 2, 'quita los 2 turnos de Ana dentro del permiso (13 y 18)');
  const s1 = DOCS['Horarios/2026-08-10_1'].shifts;
  ok(!!s1.ana['2026-08-11'], 'conserva el turno de Ana anterior al permiso (día 11)');
  ok(!s1.ana['2026-08-13'], 'quita el del 13');
  ok(!!s1.beto['2026-08-11'], 'no toca a Beto');
  ok(!DOCS['Horarios/2026-08-17_1'].shifts.ana, 'en la otra semana Ana desaparece del todo');

  // Permiso sin turnos: no rompe nada
  const n2 = await api.quitarDelHorario('caro', '2026-08-12', '2026-08-13');
  ok(n2 === 0, 'un permiso sin turnos asignados no quita nada');

  // Un día marcado libre se borra igual que un turno al aprobar un permiso
  DOCS = {
    'Horarios/2026-08-10_1': { weekStart:'2026-08-10', store:'1', shifts: {
      ana: { '2026-08-12': { libre:true }, '2026-08-14': {in:'09:00',out:'17:00'} }
    }}
  };
  const n3 = await api.quitarDelHorario('ana', '2026-08-12', '2026-08-12');
  ok(n3 === 1, 'un día libre también se quita cuando cae dentro de un permiso');
  ok(!DOCS['Horarios/2026-08-10_1'].shifts.ana['2026-08-12'], 'el día libre desaparece');
  ok(!!DOCS['Horarios/2026-08-10_1'].shifts.ana['2026-08-14'], 'el turno fuera del permiso sigue ahí');

  // ── Días libres: helpers de horario.html ──
  const html = fs.readFileSync(require('path').join(__dirname,'..','horario.html'), 'utf8');
  const hz = html.slice(html.indexOf('function esLibre'), html.indexOf('function pintar'));
  const H = new Function(hz + '\nreturn { esLibre, horasDe };')();

  ok(H.esLibre({ libre:true }) === true,  'esLibre reconoce un día libre');
  ok(H.esLibre({ in:'09:00', out:'17:00' }) === false, 'un turno normal no es libre');
  ok(H.esLibre(undefined) === false, 'una casilla vacía no es libre');

  ok(H.horasDe({ libre:true }) === 0, 'un día libre no suma horas');
  ok(H.horasDe(undefined) === 0, 'una casilla vacía no suma horas');
  ok(H.horasDe({ in:'09:00', out:'17:00' }) === 8, 'un turno de 9 a 17 son 8 horas');
  ok(H.horasDe({ in:'09:30', out:'13:00' }) === 3.5, 'medias horas se cuentan bien');

  // El total de la semana no se infla con los días libres
  const semana = { '2026-08-10': {in:'09:00',out:'17:00'},
                   '2026-08-11': { libre:true },
                   '2026-08-12': {in:'10:00',out:'14:00'} };
  const total = Object.values(semana).reduce((s,t) => s + H.horasDe(t), 0);
  ok(total === 12, 'la semana suma 12 h: los libres cuentan como cero');

  console.log(fallos ? `\n${fallos} FALLOS` : '\nHorario: todo correcto');
  process.exit(fallos ? 1 : 0);
})();
