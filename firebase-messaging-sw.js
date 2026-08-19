/* Águila — trabajador de servicio para las notificaciones push.
   Este archivo tiene que estar en la raíz del sitio y llamarse exactamente
   así: el SDK de Firebase lo busca por ese nombre. Corre aparte de la
   página, así que sigue vivo con la pestaña cerrada; por eso repite la
   configuración en vez de leerla de firebase-config.js. */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDtOfZXPEP-k_gvvu3Lvt307mOLBWezMrw",
  authDomain: "domcub.firebaseapp.com",
  projectId: "domcub",
  storageBucket: "domcub.firebasestorage.app",
  messagingSenderId: "329163319008",
  appId: "1:329163319008:web:1c7d3e71252ec4f5641285"
});

firebase.messaging();

// Al tocar el aviso: si ya hay una pestaña abierta se reutiliza, en vez de
// abrir otra más.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const chatId = (event.notification.data && event.notification.data.chatId)
    || (event.notification.data && event.notification.data.FCM_MSG
        && event.notification.data.FCM_MSG.data
        && event.notification.data.FCM_MSG.data.chatId);
  const destino = 'grupo.html' + (chatId ? '?chat=' + encodeURIComponent(chatId) : '');

  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true })
    .then(lista => {
      for (const c of lista) {
        if (c.url.includes('/grupo.html') && 'focus' in c) {
          c.navigate(destino);
          return c.focus();
        }
      }
      return clients.openWindow(destino);
    }));
});
