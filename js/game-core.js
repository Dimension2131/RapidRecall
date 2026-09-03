const CORRECT_BONUS = 2;
const WRONG_PENALTY = 5;
const STREAK_WINDOW_S = 8;
const STREAK_BONUS_CAP = 5;
const HARD_CAP_SECONDS = 900;
const CIRC = 2 * Math.PI * 34;
const DEFAULT_CLOCK = 120;
const SUDDEN_DEATH_SECONDS = 20;
const MAX_SUDDEN_DEATH_ROUNDS = 3;

const PLAYER_SLOTS = ['p1', 'p2', 'p3', 'p4'];

function isLive(status) { return status === 'active' || status === 'sudden_death'; }

function maxPlayersFor(lobby) {
  return Math.min(4, Math.max(2, lobby?.settings?.maxPlayers || 2));
}
function activeSlots(lobby) {
  return PLAYER_SLOTS.slice(0, maxPlayersFor(lobby));
}
function openSlots(lobby) {
  return activeSlots(lobby).filter((s) => !(lobby.players && lobby.players[s]));
}
function eligibleSlots(cur) {
  if (cur.status === 'sudden_death' && cur.suddenDeathParticipants) return cur.suddenDeathParticipants;
  return activeSlots(cur);
}

// ---------------- dictionary loading ----------------
const MODE_SCRIPTS = {
  classic: ['animals.js'],
  mammals: ['animals.js', 'categories.js'],
  birds: ['animals.js', 'categories.js'],
  ocean: ['animals.js', 'categories.js'],
  dinosaurs: ['animals.js', 'categories.js'],
  letters: ['animals.js'],
  chain: ['animals.js'],
  lengthlock: ['animals.js'],
  nba: ['nba_players.js'],
  football: ['football_players.js'],
  countries: ['countries.js'],
  movies: ['movies.js'],
  tv_shows: ['tv_shows.js'],
  artists: ['artists.js'],
  actors: ['actors.js'],
  superheroes: ['superheroes.js'],
  cars: ['cars.js'],
  food_drinks: ['food_drinks.js'],
  pokemon_classic: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_stage: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_legendary: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_type: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_gen: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_gen_locked: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_type_locked: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_letters: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_chain: ['pokemon.js', 'pokemon_meta.js'],
};

const loadedScripts = new Set();
let dictionaryReady = false;
let dictionaryLoadFailed = false;
let dictionaryLoadingFor = null;

function loadScriptOnce(src) {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { loadedScripts.add(src); resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function scriptsForMode(mode, settings) {
  if (mode === 'combo') {
    const cats = (settings && settings.comboCategories) || [];
    const files = new Set();
    cats.forEach((c) => (MODE_SCRIPTS[c] || []).forEach((f) => files.add(f)));
    return files.size ? Array.from(files) : ['animals.js'];
  }
  return MODE_SCRIPTS[mode] || ['animals.js'];
}

async function ensureDictionaryLoaded(mode, settings) {
  const loadKey = mode === 'combo' ? 'combo:' + ((settings && settings.comboCategories) || []).join(',') : mode;
  if (dictionaryLoadingFor === loadKey) return;
  dictionaryLoadingFor = loadKey;
  dictionaryReady = false;
  dictionaryLoadFailed = false;
  const files = scriptsForMode(mode, settings);
  try {
    await Promise.all(files.map((f) => loadScriptOnce('js/' + f)));
    dictionaryReady = true;
  } catch (err) {
    console.error(err);
    dictionaryLoadFailed = true;
  }
  if (latestLobby) render(latestLobby);
}

function modeNoun(mode, settings) {
  if (mode === 'combo') {
    const cats = (settings && settings.comboCategories) || [];
    const nouns = cats.map((c) => modeNoun(c));
    if (nouns.length === 0) return 'answer';
    if (nouns.length === 1) return nouns[0];
    return nouns.slice(0, -1).join(', ') + ' or ' + nouns[nouns.length - 1];
  }
  if (mode === 'nba') return 'NBA player';
  if (mode === 'football') return 'football player';
  if (mode === 'countries') return 'country';
  if (mode === 'movies') return 'movie';
  if (mode === 'tv_shows') return 'TV show';
  if (mode === 'artists') return 'artist';
  if (mode === 'actors') return 'actor';
  if (mode === 'superheroes') return 'superhero';
  if (mode === 'cars') return 'car';
  if (mode === 'food_drinks') return 'food or drink';
  if (isPokemonMode(mode)) return 'Pok\u00e9mon';
  return 'animal';
}

function fb() { return window.__fb; }
function isAdmin() { return localStorage.getItem('aw_is_admin') === '1'; }

const params = new URLSearchParams(window.location.search);
const CODE = (params.get('code') || '').replace(/\D/g, '').slice(0, 6);

const els = {
  codeEyebrow: document.getElementById('code-eyebrow'),
  mastheadTitle: document.getElementById('masthead-title'),
  modeBadge: document.getElementById('mode-badge'),
  joinPanel: document.getElementById('join-panel'),
  joinUsername: document.getElementById('join-username'),
  joinPanelError: document.getElementById('join-panel-error'),
  joinPanelBtn: document.getElementById('join-panel-btn'),
  waitingPanel: document.getElementById('waiting-panel'),
  waitingCode: document.getElementById('waiting-code'),
  waitingPlayers: document.getElementById('waiting-players'),
  waitingStatusText: document.getElementById('waiting-status-text'),
  becomeSpectatorBtn: document.getElementById('become-spectator-btn'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  gamePanel: document.getElementById('game-panel'),
  playersRow: document.getElementById('players-row'),
  adminEndGameBtn: document.getElementById('admin-end-game-btn'),
  leaveGameBtn: document.getElementById('leave-game-btn'),
  letterBanner: document.getElementById('letter-banner'),
  letterCurrent: document.getElementById('letter-current'),
  letterCountdown: document.getElementById('letter-countdown'),
  pokemonGenBanner: document.getElementById('pokemon-gen-banner'),
  pokemonGenCurrent: document.getElementById('pokemon-gen-current'),
  pokemonGenCountdown: document.getElementById('pokemon-gen-countdown'),
  pokemonTypeBanner: document.getElementById('pokemon-type-banner'),
  pokemonTypeCurrent: document.getElementById('pokemon-type-current'),
  pokemonTypeCountdown: document.getElementById('pokemon-type-countdown'),
  suddenDeathBanner: document.getElementById('sudden-death-banner'),
  guessForm: document.getElementById('guess-form'),
  guessInput: document.getElementById('guess-input'),
  guessSubmit: document.getElementById('guess-submit'),
  spectateNote: document.getElementById('spectate-note'),
  feedback: document.getElementById('feedback'),
  logList: document.getElementById('log-list'),
  logCount: document.getElementById('log-count'),
  resultOverlay: document.getElementById('result-overlay'),
  resultTitle: document.getElementById('result-title'),
  resultSub: document.getElementById('result-sub'),
  resultTally: document.getElementById('result-tally'),
  seriesRow: document.getElementById('series-row'),
  rematchRowPlayer: document.getElementById('rematch-row-player'),
  rematchYesBtn: document.getElementById('rematch-yes-btn'),
  rematchNoBtn: document.getElementById('rematch-no-btn'),
  rematchStatus: document.getElementById('rematch-status'),
  rematchRowSpectator: document.getElementById('rematch-row-spectator'),
};

let mySlot = null;
let myClientId = null;
let lobbyRef = null;
let latestLobby = null;
let tickHandle = null;
let myDoneReported = false;
let disconnectTimer = null;
let resultShownForFinishedAt = null;
let lastRenderedLog = undefined;
