import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, get, set, update, onValue, onDisconnect,
  runTransaction, serverTimestamp, push, child, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const db = getDatabase(app);

window.__fb = {
  db, ref, get, set, update, onValue, onDisconnect,
  runTransaction, serverTimestamp, push, child, remove
};

window.dispatchEvent(new Event('fb-ready'));
