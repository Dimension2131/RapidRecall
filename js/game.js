// Gameplay: waiting room -> live duel (2-4 players) -> result screen -> optional rematch.
//
// PLAYER COUNT: lobbies support 2-4 players, chosen at setup (default 2).
// PLAYER_SLOTS / activeSlots() below generalize everything that used to be
// hardcoded to exactly p1/p2.
//
// SCORING MODEL: running out of time locks a player out of guessing but does
// NOT end the match by itself. The match ends once every ELIGIBLE player is
// "done" (out of time, or forfeits by disconnecting). Whoever named the most
// correct entries wins (single winner). If multiple players are tied for the
// top score, they enter sudden death together; if there's still a tie after
// the sudden-death round cap, that's a shared draw among just the tied
// players (an "everyone else" who scored lower is simply not a winner,
// win/lose is decided purely by top score, no ranked placements).
//
// TIMER MODEL: each player has {baseTime, baseTimestamp}. Effective time =
// baseTime - (now - baseTimestamp)/1000. Every guess resets the anchor.
//
// STREAK MODEL: consecutive correct guesses within STREAK_WINDOW_S build a
// streak that raises the bonus per correct guess (capped). A wrong guess
// resets the streak; a duplicate or mode-mismatched guess leaves it alone.
//
// MODES: classic (any real animal), a category mode (mammals/birds/ocean/
// dinosaurs, checked against js/categories.js), "letters" (must start with
// whichever letter is currently active -- rotates every 20s, computed
// deterministically from the match's startedAt so every client agrees
// without needing to sync the rotation through the database), "chain"
// (must start with the last letter of YOUR OWN last correct animal --
// per-player state, not shared across players), "lengthlock" (exact letter
// count, configured at setup), or a player-name mode (nba/football/movies/
// etc., checked against their own separate dictionaries -- full name
// required, no category/letter restriction layered on top).
//
// ADMIN: a browser that logged in via admin.html (see ADMIN_CREDENTIALS
// note there) always joins as a read-only admin-spectator with extra
// controls to overturn a log entry's correct/wrong verdict or hand back
// time to a player. This is a client-side-only gate -- see README for the
// security caveat.
//
// SPECTATOR / SEAT SWITCHING: once every configured seat is taken, anyone
// else who opens the lobby link joins as a read-only spectator automatically.
// A seated player can also voluntarily switch to spectator themselves (see
// "become-spectator-btn" and becomeSpectator() below) -- but only while the
// lobby is still in the waiting room, before the match has started, so a
// live match never loses a player mid-round through this path.

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
// Slots currently eligible to be "the ones we're waiting on" to finish a
// round -- during sudden death, only the tied participants; otherwise every
// active seat.
function eligibleSlots(cur) {
  if (cur.status === 'sudden_death' && cur.suddenDeathParticipants) return cur.suddenDeathParticipants;
  return activeSlots(cur);
}

// ---------------- Lazy dictionary loading ----------------
//
// Only the animal dictionary + utils are loaded eagerly (see game.html) --
// every other mode's dictionary (NBA, football, movies, actors, etc.) is
// fetched on demand, starting the moment we know the lobby's mode (which
// happens as soon as we read the lobby, typically well before the match
// even starts -- see ensureDictionaryLoaded, called from render()). This
// keeps the page load light regardless of how many categories the game
// supports; it has no effect on the timer or gameplay once loaded, since
// dictionary lookups are instant (Set.has()) no matter the dictionary size.
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
  pokemon_basic: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_stage1: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_stage2: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_stage: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_monotype: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_legendary: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_type: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_gen: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_letters: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_chain: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_type_locked: ['pokemon.js', 'pokemon_meta.js'],
  pokemon_gen_locked: ['pokemon.js', 'pokemon_meta.js'],
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

async function ensureDictionaryLoaded(mode) {
  if (dictionaryLoadingFor === mode) return;
  dictionaryLoadingFor = mode;
  dictionaryReady = false;
  dictionaryLoadFailed = false;
  const files = MODE_SCRIPTS[mode] || ['animals.js'];
  try {
    await Promise.all(files.map((f) => loadScriptOnce('js/' + f)));
    dictionaryReady = true;
  } catch (err) {
    console.error(err);
    dictionaryLoadFailed = true;
  }
  if (latestLobby) render(latestLobby);
}

function modeNoun(mode) {
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
  bannerLabel: document.getElementById('banner-label'),
  bannerValue: document.getElementById('banner-value'),
  bannerCountdown: document.getElementById('banner-countdown'),
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

let mySlot = null;       // 'p1'..'p4' | 'spectator' | 'admin'
let myClientId = null;
let lobbyRef = null;
let latestLobby = null;
let tickHandle = null;
let myDoneReported = false; // kept in sync with lobby.doneFlags[mySlot] on every snapshot (see attachLobbyListener) -- see the comment there for why
let disconnectTimer = null;
let resultShownForFinishedAt = null;
let lastRenderedLog = undefined; // distinct sentinel from a lobby with no log yet (null/{})

els.codeEyebrow.textContent = CODE ? `#${CODE}` : '';

if (!CODE || CODE.length !== 6) {
  document.querySelector('.masthead .eyebrow').textContent = 'invalid code';
  els.mastheadTitle.textContent = 'Lobby not found';
  const p = document.createElement('p');
  p.className = 'hint';
  p.innerHTML = 'That link is missing a valid 6-digit code. <a href="index.html">Return home</a>.';
  document.querySelector('.masthead').appendChild(p);
  throw new Error('no code');
}

window.addEventListener('fb-ready', init, { once: true });
if (window.__fb) init();

async function init() {
  const { db, ref } = fb();
  lobbyRef = ref(db, 'lobbies/' + CODE);
  myClientId = getClientId();

  if (isAdmin()) {
    finalizeSlot('admin');
    return;
  }

  const saved = JSON.parse(localStorage.getItem('aw_last_lobby') || 'null');
  if (saved && saved.code === CODE && PLAYER_SLOTS.includes(saved.slot)) {
    mySlot = saved.slot;
    attachLobbyListener();
    return;
  }

  await resolveAndJoin();
}

async function resolveAndJoin() {
  const { get } = fb();
  let snap;
  try {
    snap = await get(lobbyRef);
  } catch (err) {
    console.error(err);
    els.mastheadTitle.textContent = 'Could not load lobby';
    return;
  }
  if (!snap.exists()) {
    els.mastheadTitle.textContent = 'Lobby not found';
    const p = document.createElement('p');
    p.className = 'hint';
    p.innerHTML = 'No lobby with that code exists (it may have expired). <a href="index.html">Return home</a>.';
    document.querySelector('.masthead').appendChild(p);
    return;
  }
  const lobby = snap.val();

  for (const slot of activeSlots(lobby)) {
    if (lobby.players?.[slot]?.clientId === myClientId) { finalizeSlot(slot); return; }
  }

  if (openSlots(lobby).length === 0) {
    finalizeSlot('spectator');
    return;
  }

  const name = getSavedUsername();
  if (name) {
    await claimPlayerSlot(name, openSlots(lobby)[0]);
  } else {
    els.joinPanel.style.display = 'block';
    els.joinPanelBtn.addEventListener('click', attemptDirectJoin);
    els.joinUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptDirectJoin(); });
  }
}

async function attemptDirectJoin() {
  const name = els.joinUsername.value.trim();
  if (!name) { els.joinPanelError.textContent = 'Enter a name first.'; return; }
  saveUsername(name);
  els.joinPanelBtn.disabled = true;
  els.joinPanelBtn.textContent = 'Joining…';
  const { get } = fb();
  const snap = await get(lobbyRef);
  const lobby = snap.exists() ? snap.val() : null;
  const preferred = lobby ? openSlots(lobby)[0] : 'p2';
  await claimPlayerSlot(name, preferred || 'p2');
}

// Tries the preferred open slot; if someone else grabs it in the same
// instant, re-checks for any other open seat and retries a few times
// before giving up and falling back to spectating.
async function claimPlayerSlot(name, preferredSlot) {
  try {
    const { ref, db, runTransaction, get } = fb();
    let slotToTry = preferredSlot;
    for (let attempt = 0; attempt < 4 && slotToTry; attempt++) {
      const slotRef = ref(db, `lobbies/${CODE}/players/${slotToTry}`);
      const result = await runTransaction(slotRef, (current) => {
        if (current) return;
        return { name, clientId: myClientId, connected: true, correct: 0, wrong: 0, streak: 0 };
      });
      if (result.committed) { finalizeSlot(slotToTry); return; }
      const snap = await get(lobbyRef);
      if (!snap.exists()) { finalizeSlot('spectator'); return; }
      const lobby = snap.val();
      const stillOpen = openSlots(lobby);
      if (stillOpen.length === 0) { finalizeSlot('spectator'); return; }
      slotToTry = stillOpen[0];
    }
    finalizeSlot('spectator');
  } catch (err) {
    console.error(err);
    els.joinPanelError.textContent = 'Something went wrong joining. Please try again.';
    els.joinPanelBtn.disabled = false;
    els.joinPanelBtn.textContent = 'Join this lobby';
  }
}

function finalizeSlot(slot) {
  mySlot = slot;
  if (PLAYER_SLOTS.includes(slot)) {
    localStorage.setItem('aw_last_lobby', JSON.stringify({ code: CODE, slot }));
  }
  els.joinPanel.style.display = 'none';
  attachLobbyListener();
}

// Lets a seated player give up their seat for someone else to join, while
// still in the waiting room. Only allowed pre-match (per design): the
// transaction is a no-op if the lobby has already started, and we detect
// that by checking whether our slot is still occupied afterward.
async function becomeSpectator() {
  if (!PLAYER_SLOTS.includes(mySlot)) return;
  const { runTransaction, ref, db, set, onDisconnect } = fb();
  const slot = mySlot;
  const txResult = await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'waiting') return cur;
    if (cur.players && cur.players[slot]) delete cur.players[slot];
    return cur;
  });
  const lobby = txResult.snapshot.val();
  if (lobby?.players?.[slot]) return; // too late -- the match already started

  const connFlagRef = ref(db, `lobbies/${CODE}/players/${slot}/connected`);
  onDisconnect(connFlagRef).cancel().catch(() => {});

  const specRef = ref(db, `lobbies/${CODE}/spectators/${myClientId}`);
  await set(specRef, true).catch(() => {});
  onDisconnect(specRef).remove();

  localStorage.removeItem('aw_last_lobby');
  mySlot = 'spectator';
  if (latestLobby) render(latestLobby);
}

function attachLobbyListener() {
  const { onValue, onDisconnect, ref, set } = fb();

  if (PLAYER_SLOTS.includes(mySlot)) {
    const connFlagRef = ref(fb().db, `lobbies/${CODE}/players/${mySlot}/connected`);
    set(connFlagRef, true).catch(() => {});
    onDisconnect(connFlagRef).set(false);
  } else {
    const specRef = ref(fb().db, `lobbies/${CODE}/spectators/${myClientId}`);
    set(specRef, mySlot === 'admin' ? 'admin' : true).catch(() => {});
    onDisconnect(specRef).remove();
  }

  document.body.classList.toggle('is-admin', mySlot === 'admin');

  onValue(lobbyRef, (snap) => {
    if (!snap.exists()) {
      els.mastheadTitle.textContent = 'Lobby closed';
      return;
    }
    const lobby = snap.val();
    // Sync the local "have I already reported myself done this round" guard
    // straight from the server's doneFlags on every snapshot, rather than
    // trying to special-case every event that should clear it (round start,
    // rematch, entering sudden death, admin restoring time to a done
    // player...). Any of those show up here as doneFlags[mySlot] flipping
    // back to false/absent, so guessing re-enables immediately with no
    // reload needed. reportDone()'s transaction is itself idempotent-safe
    // (no-ops if already marked done), so the rare race where this fires
    // between an optimistic local set and the server's confirmation just
    // costs at most one redundant call, never incorrect state.
    if (PLAYER_SLOTS.includes(mySlot)) {
      myDoneReported = !!(lobby.doneFlags && lobby.doneFlags[mySlot]);
    }
    latestLobby = lobby;
    render(lobby);
    maybeStartGame(lobby);
    if (PLAYER_SLOTS.includes(mySlot)) watchOthersDisconnect(lobby);
    if (lobby.status === 'finished') showResult(lobby);
  });

  els.copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(CODE);
    els.copyCodeBtn.textContent = 'Copied!';
    setTimeout(() => (els.copyCodeBtn.textContent = 'Copy code'), 1200);
  });
  els.copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(window.location.href);
    els.copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => (els.copyLinkBtn.textContent = 'Copy link'), 1200);
  });
  els.becomeSpectatorBtn.addEventListener('click', becomeSpectator);
  els.adminEndGameBtn.addEventListener('click', adminEndGame);
  els.leaveGameBtn.addEventListener('click', leaveGame);

  els.guessForm.addEventListener('submit', onSubmitGuess);
  const preventFocusSteal = (e) => e.preventDefault();
  els.guessSubmit.addEventListener('mousedown', preventFocusSteal);
  els.guessSubmit.addEventListener('touchstart', preventFocusSteal, { passive: false });
  els.guessSubmit.addEventListener('touchend', (e) => {
    e.preventDefault();
    onSubmitGuess(e);
  });
  els.rematchYesBtn.addEventListener('click', () => castRematchVote(true));
  els.rematchNoBtn.addEventListener('click', () => castRematchVote(false));
  els.rematchRowSpectator.addEventListener('click', () => { window.location.href = 'index.html'; });

  if (!tickHandle) tickHandle = setInterval(tick, 100);
}

function clockSecondsFor(lobby) {
  if (lobby?.status === 'sudden_death') return SUDDEN_DEATH_SECONDS;
  return lobby?.settings?.clockSeconds || DEFAULT_CLOCK;
}

async function maybeStartGame(lobby) {
  if (lobby.status !== 'waiting') return;
  if (openSlots(lobby).length > 0) return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'waiting') return cur;
    if (openSlots(cur).length > 0) return cur;
    const now = Date.now();
    const clock = clockSecondsFor(cur);
    cur.status = 'active';
    cur.startedAt = now;
    for (const slot of activeSlots(cur)) {
      cur.players[slot].baseTime = clock;
      cur.players[slot].baseTimestamp = now;
      cur.players[slot].correct = cur.players[slot].correct || 0;
      cur.players[slot].wrong = cur.players[slot].wrong || 0;
      cur.players[slot].streak = 0;
    }
    return cur;
  });
}

// Forfeit only triggers once at most one *other* seated player is still
// connected -- with 3-4 players, one person dropping doesn't end the match
// for everyone else, it just removes them from win contention.
function watchOthersDisconnect(lobby) {
  if (!isLive(lobby.status)) {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    return;
  }
  const slots = activeSlots(lobby);
  const connected = slots.filter((s) => lobby.players?.[s] && lobby.players[s].connected !== false);
  const soleSurvivorOrWorse = connected.length <= 1;
  if (soleSurvivorOrWorse && !disconnectTimer) {
    disconnectTimer = setTimeout(() => { reportForfeit(); }, 5000);
  } else if (!soleSurvivorOrWorse && disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

function effectiveTime(player, clockSeconds) {
  if (!player || player.baseTime == null || player.baseTimestamp == null) return clockSeconds || DEFAULT_CLOCK;
  const elapsed = (Date.now() - player.baseTimestamp) / 1000;
  return player.baseTime - elapsed;
}

// Returns the array of slots tied for the highest correct count among all
// active seats. Length 1 = a clear single winner; length > 1 = tied.
function computeLeaders(cur) {
  const slots = activeSlots(cur);
  let max = -Infinity;
  for (const s of slots) {
    const c = cur.players?.[s]?.correct || 0;
    if (c > max) max = c;
  }
  return slots.filter((s) => (cur.players?.[s]?.correct || 0) === max);
}

function bumpSeries(cur, winners) {
  cur.series = cur.series || { wins: {}, draws: 0, round: 1 };
  cur.series.wins = cur.series.wins || {};
  if (winners && winners.length === 1) {
    cur.series.wins[winners[0]] = (cur.series.wins[winners[0]] || 0) + 1;
  } else {
    cur.series.draws = (cur.series.draws || 0) + 1;
  }
}
function unbumpSeries(cur, winners) {
  if (!cur.series) return;
  if (winners && winners.length === 1) {
    cur.series.wins[winners[0]] = Math.max(0, (cur.series.wins[winners[0]] || 0) - 1);
  } else if (winners && winners.length > 1) {
    cur.series.draws = Math.max(0, (cur.series.draws || 0) - 1);
  }
}

function tick() {
  if (!latestLobby) return;
  render(latestLobby);
  if (!isLive(latestLobby.status)) return;

  if (PLAYER_SLOTS.includes(mySlot) && eligibleSlots(latestLobby).includes(mySlot)) {
    const clock = clockSecondsFor(latestLobby);
    const mine = latestLobby.players?.[mySlot];
    const t = effectiveTime(mine, clock);
    // myDoneReported is kept in sync with the server's doneFlags on every
    // snapshot (see attachLobbyListener), so this single check correctly
    // covers "already reported for this round" no matter which round/phase
    // we're in.
    if (t <= 0 && !myDoneReported) {
      myDoneReported = true;
      reportDone(mySlot);
    }
  }

  if (latestLobby.startedAt && (Date.now() - latestLobby.startedAt) / 1000 > HARD_CAP_SECONDS) {
    forceEndByCap();
  }
}

async function reportDone(slot) {
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    cur.doneFlags = cur.doneFlags || {};
    if (cur.doneFlags[slot]) return cur;
    cur.doneFlags[slot] = true;
    if (eligibleSlots(cur).every((s) => cur.doneFlags[s])) {
      resolveRoundEnd(cur);
    }
    return cur;
  });
}

// Called once every eligible player is done, whether that's the end of the
// normal round or a sudden-death round. If multiple players are tied for
// the top score and we haven't hit the sudden-death round cap, kicks off
// another 20s sudden-death round for just those tied players (everyone
// else is marked done and sits it out) instead of finishing.
function resolveRoundEnd(cur) {
  const leaders = computeLeaders(cur);
  if (leaders.length > 1) {
    const round = (cur.suddenDeathRound || 0) + 1;
    if (round <= MAX_SUDDEN_DEATH_ROUNDS) {
      cur.suddenDeathRound = round;
      cur.status = 'sudden_death';
      cur.suddenDeathParticipants = leaders;
      cur.doneFlags = {};
      const now = Date.now();
      for (const slot of activeSlots(cur)) {
        if (leaders.includes(slot)) {
          cur.players[slot].baseTime = SUDDEN_DEATH_SECONDS;
          cur.players[slot].baseTimestamp = now;
          cur.players[slot].streak = 0;
        } else {
          cur.doneFlags[slot] = true; // not tied for the lead -- sits out the tiebreaker
        }
      }
      return;
    }
  }
  cur.status = 'finished';
  cur.winner = leaders;
  cur.finishedAt = Date.now();
  cur.endReason = cur.suddenDeathRound ? 'sudden_death' : 'time';
  bumpSeries(cur, leaders);
}

async function reportForfeit() {
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    const slots = activeSlots(cur);
    const connected = slots.filter((s) => cur.players?.[s] && cur.players[s].connected !== false);
    if (connected.length > 1) return cur; // resolved itself (someone reconnected)
    cur.status = 'finished';
    cur.winner = connected; // one winner, or [] if literally everyone's gone
    cur.finishedAt = Date.now();
    cur.endReason = 'forfeit';
    if (connected.length === 1) bumpSeries(cur, connected);
    return cur;
  });
}

async function forceEndByCap() {
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    cur.status = 'finished';
    cur.winner = computeLeaders(cur);
    cur.finishedAt = Date.now();
    cur.endReason = 'cap';
    bumpSeries(cur, cur.winner);
    return cur;
  });
}

// Admin can force a live match to finish immediately, whoever's ahead on
// correct guesses at that moment wins (or a shared draw if tied) -- for
// stepping in on a stuck or disputed match.
async function adminEndGame() {
  if (mySlot !== 'admin') return;
  if (!confirm('End this game now for everyone? The winner will be decided by the current scores.')) return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    cur.status = 'finished';
    cur.winner = computeLeaders(cur);
    cur.finishedAt = Date.now();
    cur.endReason = 'admin_ended';
    bumpSeries(cur, cur.winner);
    return cur;
  });
}

// A seated player can voluntarily leave a live match. Unlike an accidental
// disconnect (which waits out a 5s grace period in case they reconnect),
// a confirmed deliberate leave takes effect immediately: it marks them
// disconnected and re-runs the same forfeit check disconnects use, so with
// only 2 players the remaining one wins outright, and with 3-4 players the
// match just continues without them if 2+ others are still playing.
async function leaveGame() {
  if (!PLAYER_SLOTS.includes(mySlot)) return;
  if (!confirm("Leave this game? You won't be able to rejoin this round.")) return;
  const { set, ref, db } = fb();
  const connFlagRef = ref(db, `lobbies/${CODE}/players/${mySlot}/connected`);
  await set(connFlagRef, false).catch(() => {});
  await reportForfeit();
  localStorage.removeItem('aw_last_lobby');
  window.location.href = 'index.html';
}

function setDial(slot, seconds, clockSeconds) {
  const frac = Math.max(0, Math.min(1, seconds / clockSeconds));
  const offset = (1 - frac) * CIRC;
  const dial = document.getElementById('dial-' + slot);
  if (!dial) return;
  const low = seconds <= Math.min(15, clockSeconds * 0.15);
  dial.style.strokeDashoffset = offset.toFixed(2);
  dial.classList.toggle('low', low);
  document.getElementById('dial-num-' + slot).textContent = formatTime(seconds);
  const timeEl = document.getElementById('time-' + slot);
  timeEl.textContent = formatTime(seconds);
  timeEl.classList.toggle('low', low);
}

// Builds (or updates) the player-panel DOM to match however many seats this
// lobby is configured for -- 2 to 4. Panels are created once per slot and
// then just updated in place on every subsequent render.
function ensurePlayerPanels(lobby) {
  const slots = activeSlots(lobby);
  const existingIds = new Set(Array.from(els.playersRow.children).map((el) => el.dataset.slot));

  Array.from(els.playersRow.children).forEach((el) => {
    if (!slots.includes(el.dataset.slot)) el.remove();
  });

  for (const slot of slots) {
    if (existingIds.has(slot)) continue;
    const div = document.createElement('div');
    div.className = 'player-panel';
    div.id = 'panel-' + slot;
    div.dataset.slot = slot;
    div.innerHTML = `
      <div class="p-name"><span id="name-${slot}">Player</span><span class="you-tag" id="you-tag-${slot}" style="display:none;">YOU</span></div>
      <div class="timer-dial-wrap">
        <div class="timer-dial">
          <svg viewBox="0 0 80 80">
            <circle class="timer-track" cx="40" cy="40" r="34" fill="none" stroke-width="7"></circle>
            <circle class="timer-fill" id="dial-${slot}" cx="40" cy="40" r="34" fill="none" stroke-width="7" stroke-dasharray="213.6" stroke-dashoffset="0"></circle>
            <text x="40" y="45" text-anchor="middle" class="timer-num" transform="rotate(90 40 40)" id="dial-num-${slot}">2:00</text>
          </svg>
        </div>
        <div class="stat-block">
          <div class="time-value" id="time-${slot}">2:00</div>
          <div class="counts" id="counts-${slot}">0 correct · 0 wrong</div>
          <div class="admin-time-row admin-only" id="admin-time-${slot}">
            <button type="button" class="admin-mini-btn admin-minus">\u22125s</button>
            <button type="button" class="admin-mini-btn admin-plus">+5s</button>
          </div>
        </div>
      </div>`;
    els.playersRow.appendChild(div);
  }
}

function renderWaitingRoom(lobby) {
  const slots = activeSlots(lobby);
  els.waitingPlayers.innerHTML = slots.map((slot) => {
    const p = lobby.players?.[slot];
    if (p) {
      return `<li class="joined">${escapeHtml(p.name)}${slot === mySlot ? ' (you)' : ''}</li>`;
    }
    return `<li class="open">Open seat</li>`;
  }).join('');

  const remaining = openSlots(lobby).length;
  els.waitingStatusText.textContent = remaining > 0
    ? `Waiting for ${remaining} more player${remaining === 1 ? '' : 's'}…`
    : 'Starting…';

  els.becomeSpectatorBtn.style.display = PLAYER_SLOTS.includes(mySlot) ? 'inline-block' : 'none';
}

function render(lobby) {
  const waiting = lobby.status === 'waiting';
  const active = isLive(lobby.status) || lobby.status === 'finished';
  const clock = clockSecondsFor(lobby);

  if (isLive(lobby.status)) {
    if (els.resultOverlay.style.display !== 'none') els.resultOverlay.style.display = 'none';
    resultShownForFinishedAt = null;
  }

  if (lobby.settings) {
    let label = MODE_LABELS[lobby.settings.mode] || 'Classic';
    if (lobby.settings.mode === 'pokemon_type' && lobby.settings.pokemonType) {
      label = `Pokémon: ${capitalize(lobby.settings.pokemonType)} type`;
    } else if (lobby.settings.mode === 'pokemon_gen' && lobby.settings.pokemonGen) {
      label = `Pokémon: Generation ${lobby.settings.pokemonGen}`;
    } else if (lobby.settings.mode === 'pokemon_stage') {
      const stageMap = { basic: 'Basic', stage1: 'Stage 1', stage2: 'Stage 2' };
      const stage = lobby.settings.pokemonStage || 'basic';
      label = `Pokémon: ${stageMap[stage] || stage}`;
    }
    const prefix = lobby.settings.wasMystery ? 'Mystery → ' : '';
    els.modeBadge.textContent = `${prefix}${label} · ${clock}s clock`;
    els.modeBadge.style.display = 'inline-block';
    if (dictionaryLoadingFor !== lobby.settings.mode) {
      ensureDictionaryLoaded(lobby.settings.mode);
    }
  }

  els.waitingPanel.style.display = waiting ? 'block' : 'none';
  els.gamePanel.style.display = active ? 'block' : 'none';
  els.waitingCode.textContent = CODE;

  if (waiting) {
    renderWaitingRoom(lobby);
    els.mastheadTitle.textContent = openSlots(lobby).length === 0 ? 'Starting…' : 'Waiting for players';
    return;
  }

  ensurePlayerPanels(lobby);

  const amPlayer = PLAYER_SLOTS.includes(mySlot);
  const amSpectating = mySlot === 'spectator' || mySlot === 'admin';

  els.adminEndGameBtn.style.display = (mySlot === 'admin' && isLive(lobby.status)) ? 'inline-block' : 'none';
  els.leaveGameBtn.style.display = (amPlayer && isLive(lobby.status)) ? 'inline-block' : 'none';

  if (lobby.status === 'finished') {
    els.mastheadTitle.textContent = 'Duel finished';
  } else if (lobby.status === 'sudden_death') {
    els.mastheadTitle.textContent = (mySlot === 'admin' ? 'Admin view — ' : '') + 'Sudden death! Double points';
  } else if (mySlot === 'admin') {
    els.mastheadTitle.textContent = 'Admin view';
  } else if (amSpectating) {
    els.mastheadTitle.textContent = 'Spectating';
  } else {
    els.mastheadTitle.textContent = 'Duel in progress';
  }
  document.body.classList.toggle('is-sudden-death', lobby.status === 'sudden_death');

  // ----- Banner for rotating constraints (letters, type-locked, gen-locked) -----
  const mode = lobby.settings?.mode;
  const startedAt = lobby.startedAt;
  let showBanner = false;
  let label = '';
  let value = '';
  let countdown = '';

  if (mode === 'letters' || mode === 'pokemon_letters') {
    const { letter, secondsLeft } = currentLetterRound(startedAt);
    showBanner = true;
    label = 'Current letter:';
    value = letter;
    countdown = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else if (mode === 'pokemon_type_locked') {
    const { type, secondsLeft } = currentTypeRound(startedAt);
    showBanner = true;
    label = 'Current type:';
    value = capitalize(type);
    countdown = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else if (mode === 'pokemon_gen_locked') {
    const { gen, secondsLeft } = currentGenRound(startedAt);
    showBanner = true;
    label = 'Current generation:';
    value = gen;
    countdown = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  }

  if (showBanner) {
    els.letterBanner.style.display = 'flex';
    if (els.bannerLabel) els.bannerLabel.textContent = label;
    if (els.bannerValue) els.bannerValue.textContent = value;
    if (els.bannerCountdown) els.bannerCountdown.textContent = countdown;
  } else {
    els.letterBanner.style.display = 'none';
  }

  els.suddenDeathBanner.style.display = lobby.status === 'sudden_death' ? 'block' : 'none';

  for (const slot of activeSlots(lobby)) {
    const p = lobby.players?.[slot];
    if (!p) continue;
    document.getElementById('name-' + slot).textContent = p.name || slot.toUpperCase();
    document.getElementById('you-tag-' + slot).style.display = slot === mySlot ? 'inline-block' : 'none';
    document.getElementById('panel-' + slot).classList.toggle('is-you', slot === mySlot);
    document.getElementById('panel-' + slot).classList.toggle('disconnected', p.connected === false);
    const done = lobby.doneFlags && lobby.doneFlags[slot];
    const streak = p.streak || 0;
    const streakTxt = streak >= 2 ? ` · 🔥streak ${streak}` : '';
    document.getElementById('counts-' + slot).textContent =
      `${p.correct || 0} correct · ${p.wrong || 0} wrong${streakTxt}${done ? ' · done' : ''}`;
    setDial(slot, Math.max(0, effectiveTime(p, clock)), clock);
    renderAdminTimeControls(slot);
  }

  // myDoneReported is synced from lobby.doneFlags[mySlot] on every snapshot
  // (see attachLobbyListener), so it alone is the correct, always-current
  // signal here -- no separate lobby.doneFlags check needed.
  const iAmDone = amPlayer && myDoneReported;
  const gameOver = lobby.status === 'finished';
  const canGuess = amPlayer && isLive(lobby.status) && !iAmDone && dictionaryReady;

  els.guessForm.style.display = amPlayer ? 'flex' : 'none';
  if (els.spectateNote) {
    els.spectateNote.style.display = amPlayer ? 'none' : 'block';
    if (!amPlayer) {
      els.spectateNote.textContent = mySlot === 'admin'
        ? 'Admin view — you can overturn log entries and adjust time below.'
        : "You're spectating this duel.";
    }
  }
  els.guessInput.disabled = !canGuess;
  els.guessSubmit.disabled = !canGuess;
  if (amPlayer) {
    if (gameOver) {
      els.guessInput.placeholder = 'Duel complete';
    } else if (dictionaryLoadFailed) {
      els.guessInput.placeholder = 'Could not load word list — check your connection';
    } else if (!dictionaryReady) {
      els.guessInput.placeholder = 'Loading word list…';
    } else if (iAmDone) {
      els.guessInput.placeholder = "You're out of time — waiting on the others…";
    } else {
      els.guessInput.placeholder = `Name a${/^[aeiou]/i.test(modeNoun(lobby.settings?.mode)) ? 'n' : ''} ${modeNoun(lobby.settings?.mode)}…`;
    }
  }

  // Only rebuild the log list's DOM when the underlying log data has
  // actually changed (tracked by object reference -- latestLobby.log stays
  // the SAME object across the many tick()-driven render() calls between
  // real Firebase updates). Without this guard, the admin's "Mark correct/
  // wrong" buttons were being fully destroyed and recreated every ~100ms,
  // and a click landing across that boundary (mousedown on one button
  // instance, mouseup after it had already been replaced) would get
  // silently dropped by the browser -- the reported "overturn button
  // doesn't always work" bug.
  if (lobby.log !== lastRenderedLog) {
    lastRenderedLog = lobby.log;
    renderLog(lobby);
  }
  if (lobby.status === 'finished') renderRematchState(lobby);
}

function renderAdminTimeControls(slot) {
  if (mySlot !== 'admin') return;
  const row = document.getElementById('admin-time-' + slot);
  if (!row || row.dataset.bound) return;
  row.dataset.bound = '1';
  row.querySelector('.admin-plus').addEventListener('click', () => adminAdjustTime(slot, 5));
  row.querySelector('.admin-minus').addEventListener('click', () => adminAdjustTime(slot, -5));
}

function resultLabel(result, word) {
  if (result === 'dup') return `${word} (already used)`;
  if (result === 'mode-mismatch') return `${word} (doesn't fit this round)`;
  return word;
}

function renderLog(lobby) {
  const entries = Object.entries(lobby.log || {}).sort((a, b) => a[1].ts - b[1].ts);
  els.logCount.textContent = `${entries.filter(([, e]) => e.result === 'correct').length} correct`;
  if (entries.length === 0) {
    els.logList.innerHTML = '<li class="empty-log">No guesses yet — first correct answer starts the log.</li>';
    return;
  }
  els.logList.innerHTML = entries.map(([key, e]) => {
    const wrongCls = e.result === 'wrong' ? ' wrongword' : '';
    const deltaCls = e.delta > 0 ? 'pos' : (e.delta < 0 ? 'neg' : '');
    const deltaText = e.delta > 0 ? `+${e.delta}s` : (e.delta < 0 ? `${e.delta}s` : '±0s');
    const label = resultLabel(e.result, e.word);
    const overturned = e.overturned ? ' <span class="log-overturned">(overturned)</span>' : '';
    const tagName = lobby.players?.[e.slot]?.name || (e.slot || '').toUpperCase();
    let adminBtns = '';
    if (mySlot === 'admin' && e.result !== 'dup') {
      if (e.result !== 'correct') adminBtns += `<button type="button" class="admin-mini-btn" data-logkey="${key}" data-target="correct">Mark correct</button>`;
      if (e.result !== 'wrong') adminBtns += `<button type="button" class="admin-mini-btn" data-logkey="${key}" data-target="wrong">Mark wrong</button>`;
    }
    return `<li>
      <span class="log-tag ${e.slot}">${escapeHtml(tagName)}</span>
      <span class="log-word${wrongCls}">${escapeHtml(label)}${overturned}</span>
      <span class="log-delta ${deltaCls}">${deltaText}</span>
      ${adminBtns}
    </li>`;
  }).join('');

  if (mySlot === 'admin') {
    els.logList.querySelectorAll('.admin-mini-btn').forEach((btn) => {
      btn.addEventListener('click', () => adminOverturn(btn.dataset.logkey, btn.dataset.target));
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function onSubmitGuess(e) {
  e.preventDefault();
  if (!PLAYER_SLOTS.includes(mySlot)) return;
  if (!dictionaryReady) return;
  const raw = els.guessInput.value;
  if (!raw.trim()) return;
  els.guessInput.value = '';
  els.guessInput.focus();

  const { runTransaction } = fb();
  const submittedAt = Date.now();

  const txResult = await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    const mine = cur.players?.[mySlot];
    if (!mine) return cur;
    const clock = clockSecondsFor(cur);
    if (effectiveTime(mine, clock) <= 0) return cur;

    // FIX: pass settings to matchForMode
    const canonical = matchForMode(raw, cur.settings?.mode, cur.settings);
    cur.usedAnimals = cur.usedAnimals || {};
    let result, delta;
    const now = Date.now();
    const curTime = effectiveTime(mine, clock);

    if (!canonical) {
      result = 'wrong';
      delta = -WRONG_PENALTY;
      mine.streak = 0;
      mine.wrong = (mine.wrong || 0) + 1;
    } else if (cur.usedAnimals[canonical]) {
      result = 'dup';
      delta = 0;
    } else if (!passesPlayerConstraint(canonical, cur.settings?.mode, mine, { ...cur.settings, startedAt: cur.startedAt })) {
      result = 'mode-mismatch';
      delta = 0;
    } else {
      result = 'correct';
      const priorStreak = mine.streak || 0;
      const gap = mine.lastCorrectAt ? (now - mine.lastCorrectAt) / 1000 : Infinity;
      const newStreak = (priorStreak > 0 && gap <= STREAK_WINDOW_S) ? priorStreak + 1 : 1;
      const streakBonus = Math.min(STREAK_BONUS_CAP, newStreak - 1);
      delta = CORRECT_BONUS + streakBonus;
      if (cur.status === 'sudden_death') delta *= 2;
      mine.streak = newStreak;
      mine.lastCorrectAt = now;
      mine.correct = (mine.correct || 0) + 1;
      cur.usedAnimals[canonical] = mySlot;
      if (cur.settings?.mode === 'chain' || cur.settings?.mode === 'pokemon_chain') {
        mine.chainLetter = canonical.charAt(canonical.length - 1).toUpperCase();
      }
    }

    mine.baseTime = curTime + delta;
    mine.baseTimestamp = now;
    cur.players[mySlot] = mine;

    cur.log = cur.log || {};
    const logKey = 'l' + now + '_' + Math.floor(Math.random() * 100000);
    cur.log[logKey] = { slot: mySlot, word: canonical || normalizeGuess(raw) || raw.trim(), result, delta, ts: now };

    return cur;
  });

  if (txResult.committed) {
    const lobby = txResult.snapshot.val();
    const entries = Object.values(lobby.log || {}).sort((a, b) => a.ts - b.ts);
    const mineLast = [...entries].reverse().find((en) => en.slot === mySlot && en.ts >= submittedAt);
    if (mineLast) showFeedback(mineLast);
  }
  els.guessInput.focus();
}

function showFeedback(entry) {
  if (!entry) return;
  els.feedback.classList.remove('correct', 'wrong', 'dup');
  if (entry.result === 'correct') {
    const streakTxt = entry.delta > CORRECT_BONUS ? ` (streak bonus!)` : '';
    els.feedback.textContent = `✓ ${capitalize(entry.word)} — +${entry.delta}s${streakTxt}`;
    els.feedback.classList.add('correct');
  } else if (entry.result === 'dup') {
    els.feedback.textContent = `${capitalize(entry.word)} was already guessed.`;
    els.feedback.classList.add('dup');
  } else if (entry.result === 'mode-mismatch') {
    els.feedback.textContent = `${capitalize(entry.word)} is real, but doesn't fit this round.`;
    els.feedback.classList.add('dup');
  } else {
    const noun = modeNoun(latestLobby?.settings?.mode);
    els.feedback.textContent = `Not a recognized ${noun} — ${WRONG_PENALTY}s, streak reset.`;
    els.feedback.classList.add('wrong');
  }
}

function showResult(lobby) {
  if (resultShownForFinishedAt === lobby.finishedAt) {
    els.resultOverlay.style.display = 'flex';
    renderResultTally(lobby);
    renderRematchState(lobby);
    return;
  }
  resultShownForFinishedAt = lobby.finishedAt;
  els.resultOverlay.style.display = 'flex';

  renderResultTally(lobby);

  const winners = Array.isArray(lobby.winner) ? lobby.winner : [];
  const slots = activeSlots(lobby);
  let title;
  if (winners.length === 0) {
    title = lobby.endReason === 'forfeit' ? 'Duel abandoned' : 'Duel complete';
  } else if (winners.length === slots.length) {
    title = "It's a draw!";
  } else if (winners.includes(mySlot)) {
    title = winners.length > 1 ? "You're tied for the win! 🏆" : 'You win! 🏆';
  } else if (winners.length === 1) {
    title = `${lobby.players?.[winners[0]]?.name || 'Someone'} wins`;
  } else {
    const names = winners.map((w) => lobby.players?.[w]?.name || w).join(' & ');
    title = `${names} are tied for the win`;
  }
  els.resultTitle.textContent = title;
  if (els.resultSub) {
    els.resultSub.textContent = lobby.endReason === 'forfeit'
      ? 'Decided by forfeit — one or more players disconnected.'
      : lobby.endReason === 'admin_ended'
        ? 'Ended early by an admin — decided by the score at that point.'
        : lobby.endReason === 'sudden_death'
          ? 'Tied after time ran out — decided in sudden death (double points, 20s each).'
          : 'Decided by total correct guesses.';
  }

  const amPlayer = PLAYER_SLOTS.includes(mySlot);
  els.rematchRowPlayer.style.display = amPlayer ? 'flex' : 'none';
  els.rematchRowSpectator.style.display = amPlayer ? 'none' : 'block';

  renderRematchState(lobby);
}

function renderResultTally(lobby) {
  const slots = activeSlots(lobby);
  const winners = Array.isArray(lobby.winner) ? lobby.winner : [];
  els.resultTally.innerHTML = slots.map((slot) => {
    const p = lobby.players?.[slot] || {};
    const isWinner = winners.includes(slot) && winners.length < slots.length;
    return `<div class="${isWinner ? 'is-winner' : ''}">
      <div class="who">${escapeHtml(p.name || slot.toUpperCase())}</div>
      <div class="score">${p.correct || 0}</div>
    </div>`;
  }).join('');
}

function renderRematchState(lobby) {
  const s = lobby.series || { wins: {}, draws: 0, round: 1 };
  const slots = activeSlots(lobby);
  els.seriesRow.innerHTML =
    `<span>Round ${s.round || 1}</span>` +
    slots.map((slot) => `<span><strong>${escapeHtml(lobby.players?.[slot]?.name || slot.toUpperCase())}</strong> ${s.wins?.[slot] || 0}</span>`).join('') +
    `<span>Draws ${s.draws || 0}</span>`;

  const amPlayer = PLAYER_SLOTS.includes(mySlot);
  if (!amPlayer) return;

  const votes = lobby.rematchVotes || {};
  const others = slots.filter((s2) => s2 !== mySlot);
  const declined = others.filter((s2) => votes[s2] === false);
  const stillWaitingOn = others.filter((s2) => votes[s2] !== true);

  if (declined.length > 0) {
    const names = declined.map((s2) => lobby.players?.[s2]?.name || s2.toUpperCase()).join(', ');
    els.rematchStatus.textContent = `${names} chose not to rematch.`;
    els.rematchYesBtn.disabled = true;
  } else if (votes[mySlot] === true) {
    const names = stillWaitingOn.map((s2) => lobby.players?.[s2]?.name || s2.toUpperCase()).join(', ');
    els.rematchStatus.textContent = names ? `Waiting for ${names} to respond…` : '';
    els.rematchYesBtn.disabled = true;
  } else {
    els.rematchStatus.textContent = '';
    els.rematchYesBtn.disabled = false;
  }
}

async function castRematchVote(vote) {
  if (!PLAYER_SLOTS.includes(mySlot)) return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'finished') return cur;
    cur.rematchVotes = cur.rematchVotes || {};
    cur.rematchVotes[mySlot] = vote;
    const slots = activeSlots(cur);
    if (vote === true && slots.every((s) => cur.rematchVotes[s] === true)) {
      startNewRound(cur);
    }
    return cur;
  });
  if (vote === false) {
    window.location.href = 'index.html';
  }
}

function startNewRound(cur) {
  const now = Date.now();
  const clock = clockSecondsFor(cur);
  cur.status = 'active';
  cur.startedAt = now;
  cur.winner = null;
  cur.endReason = null;
  cur.finishedAt = null;
  cur.usedAnimals = {};
  cur.log = {};
  cur.doneFlags = {};
  cur.rematchVotes = {};
  cur.suddenDeathRound = 0;
  delete cur.suddenDeathParticipants;
  cur.series = cur.series || { wins: {}, draws: 0, round: 1 };
  cur.series.round = (cur.series.round || 1) + 1;
  for (const slot of activeSlots(cur)) {
    if (!cur.players[slot]) continue;
    cur.players[slot].baseTime = clock;
    cur.players[slot].baseTimestamp = now;
    cur.players[slot].correct = 0;
    cur.players[slot].wrong = 0;
    cur.players[slot].streak = 0;
    delete cur.players[slot].lastCorrectAt;
    delete cur.players[slot].chainLetter;
  }
}

// ---------------- Admin actions ----------------

async function adminOverturn(logKey, newResult) {
  if (mySlot !== 'admin') return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !cur.log || !cur.log[logKey]) return cur;
    const entry = cur.log[logKey];
    if (entry.result === newResult || entry.result === 'dup') return cur;
    const slot = entry.slot;
    const player = cur.players?.[slot];
    if (!player) return cur;
    const clock = clockSecondsFor(cur);

    const oldDelta = entry.delta;
    const newDelta = newResult === 'correct' ? CORRECT_BONUS : -WRONG_PENALTY;
    const diff = newDelta - oldDelta;

    const now = Date.now();
    const curTime = effectiveTime(player, clock);
    const newTime = curTime + diff;
    player.baseTime = newTime;
    player.baseTimestamp = now;

    if (entry.result === 'correct') player.correct = Math.max(0, (player.correct || 0) - 1);
    if (entry.result === 'wrong') player.wrong = Math.max(0, (player.wrong || 0) - 1);
    if (newResult === 'correct') player.correct = (player.correct || 0) + 1;
    if (newResult === 'wrong') player.wrong = (player.wrong || 0) + 1;

    cur.usedAnimals = cur.usedAnimals || {};
    if (newResult === 'correct') {
      cur.usedAnimals[entry.word] = slot;
    } else if (entry.result === 'correct' && cur.usedAnimals[entry.word] === slot) {
      delete cur.usedAnimals[entry.word];
    }

    entry.result = newResult;
    entry.delta = newDelta;
    entry.overturned = true;
    cur.players[slot] = player;
    cur.log[logKey] = entry;

    reopenIfPositive(cur, slot, newTime);
    if (cur.status === 'finished' && cur.endReason !== 'forfeit') {
      const newWinners = computeLeaders(cur);
      const oldWinners = Array.isArray(cur.winner) ? cur.winner : [];
      if (JSON.stringify(newWinners) !== JSON.stringify(oldWinners)) {
        unbumpSeries(cur, oldWinners);
        bumpSeries(cur, newWinners);
        cur.winner = newWinners;
      }
    }
    return cur;
  });
}

async function adminAdjustTime(slot, deltaSeconds) {
  if (mySlot !== 'admin') return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !cur.players?.[slot]) return cur;
    const player = cur.players[slot];
    const clock = clockSecondsFor(cur);
    const now = Date.now();
    const curTime = effectiveTime(player, clock);
    const newTime = curTime + deltaSeconds;
    player.baseTime = newTime;
    player.baseTimestamp = now;
    cur.players[slot] = player;
    reopenIfPositive(cur, slot, newTime);
    return cur;
  });
}

function reopenIfPositive(cur, slot, newTime) {
  if (newTime > 0 && cur.doneFlags && cur.doneFlags[slot]) {
    cur.doneFlags[slot] = false;
    // A deliberate admin "End game" should stay ended -- restoring time to a
    // player afterward shouldn't silently un-finish the match, same as a
    // forfeit already doesn't get reopened this way.
    if (cur.status === 'finished' && cur.endReason !== 'forfeit' && cur.endReason !== 'admin_ended') {
      unbumpSeries(cur, Array.isArray(cur.winner) ? cur.winner : []);
      cur.status = cur.endReason === 'sudden_death' ? 'sudden_death' : 'active';
      cur.winner = null;
      cur.finishedAt = null;
    }
  }
}