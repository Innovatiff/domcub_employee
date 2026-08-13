/**
 * El Águila — envío de notificaciones push
 *
 * Un navegador no puede mandar una push a otro: hace falta una credencial
 * de servidor, y esa credencial no puede vivir en el código de la página
 * porque cualquiera podría leerla. Por eso este trozo corre en Cloud
 * Functions, donde la credencial es la del propio proyecto.
 *
 * Avisa de cuatro cosas:
 *   · mensajes nuevos — al privado sólo sus participantes, y de los
 *     anuncios todo el equipo, en ambos casos menos quien escribió;
 *   · recibos de pago — al colaborador cuando el suyo queda disponible y
 *     cuando se marca como pagado;
 *   · viajes — a la gerencia cuando alguien sale a la farmacia y cuando
 *     vuelve;
 *   · pedidos — a la gerencia cuando se crea uno.
 *
 * Los destinos salen de PushTokens/{token} = { pid }, que cada dispositivo
 * escribe al conceder el permiso. Un mismo pid puede tener varios (el
 * teléfono, la tablet de la tienda, el navegador del mostrador).
 */

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore }  = require('firebase-admin/firestore');
const { getMessaging }  = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

// Firestore no deja consultar 'in' con más de 30 valores.
const LOTE_IN = 30;

async function tokensDe(pids) {
  if (!pids.length) return [];
  const out = [];
  for (let i = 0; i < pids.length; i += LOTE_IN) {
    const snap = await db.collection('PushTokens')
      .where('pid', 'in', pids.slice(i, i + LOTE_IN)).get();
    snap.docs.forEach(d => out.push(d.id));
  }
  return [...new Set(out)];
}

async function todosLosTokens() {
  const snap = await db.collection('PushTokens').get();
  return snap.docs.map(d => d.id);
}

async function tokensDelRemitente(pid) {
  const snap = await db.collection('PushTokens').where('pid', '==', pid).get();
  return new Set(snap.docs.map(d => d.id));
}

/**
 * Manda la push y limpia los tokens que ya no valen.
 *
 * Un token deja de servir cuando desinstalan la app o limpian el navegador.
 * Si no se borran, la colección crece con basura para siempre y cada envío
 * arrastra intentos que se sabe que van a fallar.
 */
async function enviar(tokens, titulo, cuerpo, datos, etiqueta) {
  if (!tokens.length) return { successCount: 0, failureCount: 0 };

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: titulo, body: cuerpo },
    data: datos || {},
    webpush: {
      // Sin `link`: un mismo aviso llega a la gerencia y al portal, que son
      // dos sitios distintos, y cualquier ruta daría 404 en el otro. Al
      // tocarlo decide el trabajador de servicio de cada aplicación.
      notification: { icon: '/icon-192.png', tag: etiqueta, renotify: true }
    }
  });

  const muertos = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') muertos.push(tokens[i]);
  });
  await Promise.all(muertos.map(t =>
    db.collection('PushTokens').doc(t).delete().catch(() => {})));

  console.log(`${etiqueta}: ${res.successCount} enviadas, ${res.failureCount} fallidas, ` +
              `${muertos.length} tokens caducados`);
  return res;
}

/** Tokens de todos los dispositivos de la gerencia. */
async function tokensGerencia() {
  const mgrs = await db.collection('Main').get();
  return tokensDe(mgrs.docs.map(d => 'mgr:' + d.id));
}

// ── Viajes a las farmacias ──
//
// Dos momentos: al salir la gerencia sabe quién anda fuera y con qué
// carro, y al volver le llegan los kilómetros sin abrir nada.
exports.avisarViaje = onDocumentWritten('Registros/{id}', async event => {
  const antes = event.data.before.exists ? event.data.before.data() : null;
  const ahora = event.data.after.exists  ? event.data.after.data()  : null;
  if (!ahora) return;                                // borrado

  const tienda = ahora.store === '1' ? 'Despensas' : ahora.store === '2' ? 'Cocina' : '';
  let titulo, cuerpo;
  if (!antes && ahora.status === 'en-ruta') {
    titulo = 'Salió a la farmacia';
    cuerpo = `${ahora.employeeName || 'Alguien'} · ${ahora.vehiculo || 'sin carro'} · ${tienda}`;
  } else if (antes && antes.status === 'en-ruta' && ahora.status === 'completado') {
    titulo = 'Viaje completado';
    cuerpo = `${ahora.employeeName || 'Alguien'} · ${ahora.km != null ? ahora.km + ' km' : ''} · ${tienda}`;
  } else {
    return;                                          // ediciones sin cambio de fase
  }

  const tokens = await tokensGerencia();
  await enviar(tokens, titulo, cuerpo, { tipo: 'viaje' }, 'viaje-' + event.params.id);
});

// ── Pedidos ──
exports.avisarPedido = onDocumentCreated('Pedidos/{id}', async event => {
  const p = event.data && event.data.data();
  if (!p) return;
  const tienda = p.store === '1' ? 'Despensas' : p.store === '2' ? 'Cocina' : '';
  const n = Array.isArray(p.items) ? p.items.length : 0;
  const tokens = await tokensGerencia();
  await enviar(tokens,
    'Pedido nuevo' + (tienda ? ' · ' + tienda : ''),
    `${p.title || 'Pedido'} · ${p.createdByName || '—'} · ${n} ${n === 1 ? 'artículo' : 'artículos'}`,
    { tipo: 'pedido' }, 'pedido-' + event.params.id);
});

// ── Reportes de incidentes ──
//
// Un reporte es algo que la gerencia debe ver pronto: se le avisa a todos
// sus dispositivos en cuanto se crea, venga de un colaborador o de otra
// cuenta de gerencia.
exports.avisarReporte = onDocumentCreated('Reportes/{id}', async event => {
  const r = event.data && event.data.data();
  if (!r) return;
  const tienda = r.store === '1' ? 'Despensas' : r.store === '2' ? 'Cocina' : '';
  const texto = String(r.texto || '').slice(0, 90) || 'Sin descripción';
  const tokens = await tokensGerencia();
  await enviar(tokens,
    '⚠️ Reporte nuevo' + (tienda ? ' · ' + tienda : ''),
    `${r.nombre || 'Alguien'}: ${texto}${r.foto ? ' 📷' : ''}`,
    { tipo: 'reporte' }, 'reporte-' + event.params.id);
});

// ── Recibos de pago ──

const MCORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

/** "10 – 23 ago" a partir de las fechas del período. */
function etiquetaPeriodo(desde, hasta) {
  const a = new Date(String(desde) + 'T00:00:00');
  const b = new Date(String(hasta) + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return '';
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${MCORTO[b.getMonth()]}`
    : `${a.getDate()} ${MCORTO[a.getMonth()]} – ${b.getDate()} ${MCORTO[b.getMonth()]}`;
}

/** Importe en español: el CLDR no agrupa cifras de cuatro dígitos. */
function money(n) {
  const v = Number(n) || 0;
  const [ent, dec] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '-$' : '$') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

/**
 * Avisa al colaborador de su recibo.
 *
 * Dos momentos distintos, porque significan cosas distintas: cuando el
 * recibo aparece en el portal ya puede revisar sus horas, y cuando se marca
 * como pagado sabe que el dinero salió. Se usa onDocumentWritten para
 * enterarse de ambos con un solo disparador.
 *
 * No avisa de un recibo en cero: no hay nada que mirar y sería ruido.
 */
exports.avisarRecibo = onDocumentWritten('PayStatements/{id}', async event => {
  const antes  = event.data.before.exists ? event.data.before.data() : null;
  const ahora  = event.data.after.exists  ? event.data.after.data()  : null;
  if (!ahora || !ahora.employeeId) return;          // borrado, o sin dueño

  const bruto = Number(ahora.gross || 0);
  const periodo = etiquetaPeriodo(ahora.periodStart, ahora.periodEnd);

  let titulo, cuerpo;
  if (!antes) {
    if (bruto <= 0) return;
    titulo = 'Tu recibo ya está listo';
    cuerpo = `${periodo} · ${money(bruto)} por ${Number(ahora.hours || 0).toFixed(2)} h`;
  } else if (antes.status !== 'paid' && ahora.status === 'paid') {
    titulo = 'Pago realizado';
    cuerpo = `${periodo} · ${money(bruto)}. Ya puedes ver tu comprobante.`;
  } else {
    // Recalcular un recibo pendiente no merece un aviso: la gerencia puede
    // regenerar la nómina varias veces mientras cuadra las horas.
    return;
  }

  const tokens = await tokensDe(['emp:' + ahora.employeeId]);
  await enviar(tokens, titulo, cuerpo, { tipo: 'recibo' }, 'recibo-' + event.params.id);
});

// ── Mensajes del chat ──

exports.avisarMensaje = onDocumentCreated('Messages/{id}', async event => {
  const msg = event.data && event.data.data();
  if (!msg || !msg.chatId) return;

  const chatSnap = await db.collection('Chats').doc(msg.chatId).get();
  const chat = chatSnap.exists ? chatSnap.data() : {};

  const esAnuncio = msg.chatId === 'anuncios';
  const destinos = esAnuncio
    ? await todosLosTokens()
    : await tokensDe((chat.participants || []).filter(p => p !== msg.senderId));

  // Aunque en un privado el remitente no es destinatario, en Anuncios sí
  // entraría; y en cualquier caso puede tener varios dispositivos.
  const mios = await tokensDelRemitente(msg.senderId);
  const tokens = destinos.filter(t => !mios.has(t));
  if (!tokens.length) return;

  const titulo = esAnuncio
    ? 'Anuncios Generales'
    : chat.type === 'grupo'
      ? `${chat.title || 'Grupo'} · ${msg.senderName || ''}`
      : (msg.senderName || 'Nuevo mensaje');
  // Una foto no trae texto: sin esto el aviso llegaría con el cuerpo vacío.
  const cuerpo = msg.type === 'image'
    ? '📷 Foto'
    : String(msg.text || '').slice(0, 140);

  await enviar(tokens, titulo, cuerpo, { chatId: msg.chatId }, 'chat ' + msg.chatId);
});

// ══════════════════════════════════════════════════════════
//  Resumen semanal — cada domingo a las 7 pm (hora de Puerto Rico)
//
//  Junta la semana que termina (lunes a domingo): horas y costo por
//  tienda contra la semana anterior, viajes, tareas y reportes. Lo deja
//  en Resumenes/{lunes} —que sólo lee la gerencia— y avisa con una push.
//  El costo de nómina es dato sensible: por eso NO va al chat de anuncios.
// ══════════════════════════════════════════════════════════

const { onSchedule } = require('firebase-functions/v2/scheduler');

const aFecha = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};

exports.resumenSemanal = onSchedule(
  { schedule: '0 19 * * 0', timeZone: 'America/Puerto_Rico' },
  async () => {
    // El domingo la semana en curso es lunes..hoy
    const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' }));
    const dow = (hoy.getDay() + 6) % 7;            // 0 = lunes
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - dow);
    const lunesPrev = new Date(lunes); lunesPrev.setDate(lunes.getDate() - 7);

    const desde = aFecha(lunes), hasta = aFecha(hoy);
    const desdePrev = aFecha(lunesPrev), hastaPrev = aFecha(new Date(lunes.getTime() - 86400000));

    const [cis, emps, regs, hechas, reps] = await Promise.all([
      db.collection('ClockIns').where('date', '>=', desdePrev).where('date', '<=', hasta).get(),
      db.collection('Employees').get(),
      db.collection('Registros').where('date', '>=', desde).where('date', '<=', hasta).get(),
      db.collection('TareasHechas').where('date', '>=', desde).where('date', '<=', hasta).get(),
      db.collection('Reportes').where('date', '>=', desde).where('date', '<=', hasta).get(),
    ]);

    const tarifa = {};
    emps.docs.forEach(d => tarifa[d.id] = Number(d.data().hourlyRate) || 0);

    // Horas y costo por tienda, esta semana y la anterior
    const suma = { act: { '1':{h:0,c:0}, '2':{h:0,c:0} }, prev: { '1':{h:0,c:0}, '2':{h:0,c:0} } };
    cis.docs.forEach(d => {
      const c = d.data();
      if (!c.clockOut || !c.hours) return;
      const grupo = c.date >= desde ? 'act' : 'prev';
      const st = suma[grupo][c.store];
      if (!st) return;
      st.h += c.hours;
      st.c += c.hours * (tarifa[c.employeeId] || 0);
    });

    const viajes = regs.docs.map(d => d.data()).filter(r => r.status === 'completado');
    const kms = viajes.reduce((s, r) => s + (Number(r.km) || 0), 0);
    const renglones = hechas.docs.reduce((s, d) => s + Object.keys(d.data().hechos || {}).length, 0);
    const nReps = reps.size;

    const linea = (nombre, st) => {
      const a = suma.act[st], p = suma.prev[st];
      const dif = p.h ? Math.round((a.h - p.h) / p.h * 100) : null;
      return `${nombre}: ${a.h.toFixed(1)} h · ${money(a.c)}`
        + (dif === null ? '' : ` (${dif >= 0 ? '+' : ''}${dif}% vs semana pasada)`);
    };

    const etiqueta = `${lunes.getDate()} ${MCORTO[lunes.getMonth()]} – ${hoy.getDate()} ${MCORTO[hoy.getMonth()]}`;
    const texto = [
      `Semana del ${etiqueta}`,
      '',
      '🏪 ' + linea('Despensas', '1'),
      '🍳 ' + linea('Cocina', '2'),
      `💰 Nómina total de la semana: ${money(suma.act['1'].c + suma.act['2'].c)}`,
      '',
      `🚗 Viajes a farmacias: ${viajes.length} (${kms.toFixed(0)} km)`,
      `✅ Renglones de tareas completados: ${renglones}`,
      `⚠️ Reportes de incidentes: ${nReps}`,
    ].join('\n');

    await db.collection('Resumenes').doc(desde).set({
      semana: etiqueta, desde, hasta, texto,
      createdAt: new Date()
    });

    const tokens = await tokensGerencia();
    await enviar(tokens, '📊 Resumen semanal listo',
      `Nómina ${money(suma.act['1'].c + suma.act['2'].c)} · abre el Panel para verlo`,
      { tipo: 'resumen' }, 'resumen-' + desde);
  });
