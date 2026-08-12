// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDtOfZXPEP-k_gvvu3Lvt307mOLBWezMrw",
  authDomain: "domcub.firebaseapp.com",
  projectId: "domcub",
  storageBucket: "domcub.firebasestorage.app",
  messagingSenderId: "329163319008",
  appId: "1:329163319008:web:1c7d3e71252ec4f5641285",
  measurementId: "G-668H2W780D"
};

// Clave pública de notificaciones push (VAPID). Se saca de
// Firebase Console → Configuración del proyecto → Cloud Messaging →
// Certificados push web → Generar par de claves, y se pega aquí.
// Mientras esté vacía, las notificaciones con la app cerrada quedan
// desactivadas; todo lo demás funciona igual.
const VAPID_KEY = "BDyHLK04-tsVFXfN8sIXgKgGmM0qZpYgoblgKqVLIWgH8J0oktFacUXlTIKt2nFQPMqPmzamcTt3S7zOkIRjB74";

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();
