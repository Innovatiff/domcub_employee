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

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();
