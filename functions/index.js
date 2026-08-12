/**
 * El Águila — envío de notificaciones push
 *
 * Un navegador no puede mandar una push a otro: hace falta una credencial
 * de servidor, y esa credencial no puede vivir en el código de la página
 * porque cualquiera podría leerla. Por eso este trozo corre en Cloud
 * Functions, donde la credencial es la del propio proyecto.
 *
 * Se dispara al crearse un mensaje y avisa sólo a quien corresponde:
 *   · conversación privada → a los participantes, menos quien escribió
 *   · Anuncios Generales   → a todo el mundo, menos quien escribió
 *
 * Los destinos salen de PushTokens/{token} = { pid }, que cada dispositivo
 * escribe al conceder el permiso. Un mismo pid puede tener varios (el
 * teléfono, la tablet de la tienda, el navegador del mostrador).
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
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
  const cuerpo = String(msg.text || '').slice(0, 140);

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: titulo, body: cuerpo },
    data: { chatId: msg.chatId },
    webpush: {
      // Sin `link` a propósito. Un mismo mensaje va a la gerencia y al
      // portal, que son dos sitios distintos: cualquier ruta que se ponga
      // aquí acaba dando 404 en el otro. Al tocar el aviso decide el
      // trabajador de servicio de cada app, que sí sabe qué páginas tiene.
      notification: { icon: '/icon-192.png', tag: msg.chatId, renotify: true }
    }
  });

  // Un token deja de valer cuando desinstalan la app o limpian el
  // navegador. Si no se borran, la lista crece con basura para siempre.
  const muertos = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') muertos.push(tokens[i]);
  });
  await Promise.all(muertos.map(t =>
    db.collection('PushTokens').doc(t).delete().catch(() => {})));

  console.log(`chat ${msg.chatId}: ${res.successCount} enviadas, ` +
              `${res.failureCount} fallidas, ${muertos.length} tokens caducados`);
});
