/**
 * El Águila — envío de notificaciones push
 *
 * Un navegador no puede mandar una push a otro: hace falta una credencial
 * de servidor, y esa credencial no puede vivir en el código de la página
 * porque cualquiera podría leerla. Por eso este trozo corre en Cloud
 * Functions, donde la credencial es la del propio proyecto.
 *
 * Avisa de dos cosas:
 *   · mensajes nuevos — al privado sólo sus participantes, y de los
 *     anuncios todo el equipo, en ambos casos menos quien escribió;
 *   · recibos de pago — al colaborador cuando el suyo queda disponible y
 *     cuando se marca como pagado.
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
    : (msg.senderName || 'Nuevo mensaje');
  // Una foto no trae texto: sin esto el aviso llegaría con el cuerpo vacío.
  const cuerpo = msg.type === 'image'
    ? '📷 Foto'
    : String(msg.text || '').slice(0, 140);

  await enviar(tokens, titulo, cuerpo, { chatId: msg.chatId }, 'chat ' + msg.chatId);
});
