// Initializes the Firebase app + Realtime Database connection used by
// home.js and game.js. Uses the modular v10 SDK straight from Google's CDN,
// so no build step / npm install is required for GitHub Pages hosting.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, get, set, update, onValue, onDisconnect,
  runTransaction, serverTimestamp, push, child, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const db = getDatabase(app);

// Expose on window so the plain (non-module) utils.js / inline handlers
// and the other module scripts can all reach the same instance.
window.__fb = {
  db, ref, get, set, update, onValue, onDisconnect,
  runTransaction, serverTimestamp, push, child, remove
};

// Signal readiness for scripts that load before this finishes initializing.
window.dispatchEvent(new Event('fb-ready'));
