// Prueba del cálculo de la nómina, sin navegador ni Firestore.
//
// Se ejecuta con:  node tests/nomina.test.js
//
// Extrae generarNomina de app.js y le pone unas colecciones de mentira
// delante. No sustituye a probar la página en el navegador; cubre lo que sí
// se puede comprobar sin abrirla: que las sumas cuadren, que no aparezcan
// NaN y —sobre todo— que volver a generar no toque lo que ya está pagado.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');

// Se extrae sólo la función a probar, con sus ayudantes de período.
const trozo = (desde, hasta) => src.slice(src.indexOf(desde), src.indexOf(hasta));
const periodos = trozo('const PERIOD_ORIGIN', '// ── Avatares ──');
const nomina   = trozo('async function generarNomina', '// ── Pedidos ──');

let EMPS = [], MARCAS = [], STMTS = [], SEQ = 0;
const toDateStr = d => { const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const parseLocalDate = v => new Date(v + 'T00:00:00');
const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

const getEmployees      = async () => EMPS.map(e => ({...e}));
const getClockInsRange  = async (a,b) => MARCAS.filter(m => m.date >= a && m.date <= b).map(m => ({...m}));
const getPayStatements  = async p => STMTS.filter(s => s.periodStart === p).map(s => ({...s}));
const savePayStatement  = async d => { STMTS.push({ id: 'st' + (++SEQ), ...d }); };
const updatePayStatement = async (id, d) => { Object.assign(STMTS.find(s => s.id === id), d); };
const deletePayStatement = async id => { STMTS = STMTS.filter(s => s.id !== id); };

const cargar = new Function(
  'toDateStr','parseLocalDate','MESES_CORTOS','getEmployees','getClockInsRange',
  'getPayStatements','savePayStatement','updatePayStatement','deletePayStatement',
  periodos + '\n' + nomina + '\nreturn { generarNomina, getPeriodByIndex, getPeriodIndex };');

const api = cargar(toDateStr, parseLocalDate, MESES_CORTOS, getEmployees, getClockInsRange,
                   getPayStatements, savePayStatement, updatePayStatement, deletePayStatement);
const { generarNomina, getPeriodByIndex, getPeriodIndex } = api;

const P = getPeriodByIndex(getPeriodIndex(new Date('2026-08-12T00:00:00')));
const dia = P.start;

function reset() {
  SEQ = 0;
  EMPS = [
    { id:'a', name:'Ana',  status:'active',   store:'1', hourlyRate:15 },
    { id:'b', name:'Beto', status:'active',   store:'2', hourlyRate:18.5 },
    { id:'c', name:'Caro', status:'active',   store:'1', hourlyRate:null },  // sin tarifa
    { id:'d', name:'Dani', status:'inactive', store:'2', hourlyRate:20 },
  ];
  MARCAS = [
    { employeeId:'a', date:dia, clockOut:1, hours:8 },
    { employeeId:'a', date:dia, clockOut:1, hours:4.5 },
    { employeeId:'a', date:dia, clockOut:null, hours:null },   // turno abierto
    { employeeId:'b', date:dia, clockOut:1, hours:10 },
    { employeeId:'d', date:dia, clockOut:1, hours:6 },         // inactivo
  ];
  STMTS = [];
}

let fallos = 0;
const comprobar = (cond, que) => {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + que);
  if (!cond) fallos++;
};

(async () => {
  console.log('\n1. Generación desde cero');
  reset();
  let r = await generarNomina(P.start);
  const de = id => STMTS.find(s => s.employeeId === id);
  comprobar(de('a').hours === 12.5, 'suma sólo los turnos cerrados de Ana (8 + 4,5, no el abierto)');
  comprobar(de('a').gross === 187.5, 'bruto de Ana = 12,5 x 15 = 187,50');
  comprobar(de('b').gross === 185, 'bruto de Beto = 10 x 18,5 = 185');
  comprobar(!de('d'), 'no genera recibo a quien está dado de baja');
  comprobar(!de('c'), 'sin horas no hay recibo');
  comprobar(r.sinHoras === 1, 'informa de 1 colaborador sin horas');
  comprobar(STMTS.every(s => typeof s.gross === 'number' && !isNaN(s.gross)), 'ningún importe es NaN');

  console.log('\n2. Volver a generar no duplica ni pisa lo pagado');
  de('a').status = 'paid';
  de('a').paidDate = '2026-08-20';
  MARCAS.push({ employeeId:'a', date:dia, clockOut:1, hours:3 });   // horas nuevas
  MARCAS.push({ employeeId:'b', date:dia, clockOut:1, hours:2 });
  r = await generarNomina(P.start);
  comprobar(STMTS.filter(s => s.employeeId === 'a').length === 1, 'no duplica el recibo de Ana');
  comprobar(de('a').gross === 187.5, 'el recibo pagado conserva su importe');
  comprobar(de('a').status === 'paid', 'el recibo pagado sigue pagado');
  comprobar(r.conservados === 1, 'informa de 1 recibo conservado');
  comprobar(de('b').hours === 12, 'el recibo pendiente de Beto sí se actualiza (10 + 2)');
  comprobar(de('b').gross === 222, 'y su bruto se recalcula: 12 x 18,5 = 222');

  console.log('\n3. Tarifa sin definir no produce NaN');
  reset();
  MARCAS.push({ employeeId:'c', date:dia, clockOut:1, hours:5 });
  await generarNomina(P.start);
  const c = STMTS.find(s => s.employeeId === 'c');
  comprobar(c && c.gross === 0, 'sin tarifa, el bruto es 0 y no NaN');
  comprobar(c && c.rate === 0, 'la tarifa guardada es 0');

  console.log('\n4. Quien se da de baja pierde el recibo pendiente, no el pagado');
  reset();
  await generarNomina(P.start);
  const pagado = STMTS.find(s => s.employeeId === 'b');
  pagado.status = 'paid';
  EMPS.find(e => e.id === 'a').status = 'inactive';
  EMPS.find(e => e.id === 'b').status = 'inactive';
  await generarNomina(P.start);
  comprobar(!STMTS.find(s => s.employeeId === 'a'), 'se retira el recibo pendiente del que se dio de baja');
  comprobar(!!STMTS.find(s => s.employeeId === 'b'), 'se conserva el recibo ya pagado');

  console.log('\n5. El recibo guarda con qué tienda y nombre se generó');
  reset();
  await generarNomina(P.start);
  comprobar(de('a').store === '1' && de('a').employeeName === 'Ana', 'guarda tienda y nombre');
  comprobar(de('a').periodStart === P.start && de('a').periodEnd === P.end, 'guarda el período completo');

  console.log(fallos ? `\n${fallos} COMPROBACIONES FALLIDAS` : '\nTodo correcto');
  process.exit(fallos ? 1 : 0);
})();
