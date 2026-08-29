const CORRECT_BONUS = 2;
const WRONG_PENALTY = 5;
const STREAK_WINDOW_S = 8;
const STREAK_BONUS_CAP = 5;
const HARD_CAP_SECONDS = 900;
const CIRC = 2 * Math.PI * 34;
const DEFAULT_CLOCK = 120;
const SUDDEN_DEATH_SECONDS = 20;
const MAX_SUDDEN_DEATH_ROUNDS = 3;

function isLive(status) { return status === 'active' || status === 'sudden_death'; }

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
  copyCodeBtn: document.getElementById('copy-code-btn'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  gamePanel: document.getElementById('game-panel'),
  letterBanner: document.getElementById('letter-banner'),
  letterCurrent: document.getElementById('letter-current'),
  letterCountdown: document.getElementById('letter-countdown'),
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
  resultNameP1: document.getElementById('result-name-p1'),
  resultNameP2: document.getElementById('result-name-p2'),
  resultScoreP1: document.getElementById('result-score-p1'),
  resultScoreP2: document.getElementById('result-score-p2'),
  seriesRow: document.getElementById('series-row'),
  rematchRowPlayer: document.getElementById('rematch-row-player'),
  rematchYesBtn: document.getElementById('rematch-yes-btn'),
  rematchNoBtn: document.getElementById('rematch-no-btn'),
  rematchStatus: document.getElementById('rematch-status'),
  rematchRowSpectator: document.getElementById('rematch-row-spectator'),
};

let mySlot = null;       // 'p1' | 'p2' | 'spectator' | 'admin'
let myClientId = null;
let lobbyRef = null;
let latestLobby = null;
let tickHandle = null;
let myDoneReported = false;
let disconnectTimer = null;
let resultShownForFinishedAt = null; // avoid re-showing overlay repeatedly on every snapshot

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
  if (saved && saved.code === CODE && (saved.slot === 'p1' || saved.slot === 'p2')) {
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
  if (lobby.players?.p1?.clientId === myClientId) { finalizeSlot('p1'); return; }
  if (lobby.players?.p2?.clientId === myClientId) { finalizeSlot('p2'); return; }

  if (lobby.players?.p2) {
    finalizeSlot('spectator');
    return;
  }

  const name = getSavedUsername();
  if (name) {
    await claimPlayerSlot(name, 'p2');
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
  await claimPlayerSlot(name, 'p2');
}

async function claimPlayerSlot(name, slot) {
  try {
    const { ref, db, runTransaction } = fb();
    const slotRef = ref(db, `lobbies/${CODE}/players/${slot}`);
    const result = await runTransaction(slotRef, (current) => {
      if (current) return;
      return { name, clientId: myClientId, connected: true, correct: 0, wrong: 0, streak: 0 };
    });
    if (!result.committed) {
      finalizeSlot('spectator');
      return;
    }
    finalizeSlot(slot);
  } catch (err) {
    console.error(err);
    els.joinPanelError.textContent = 'Something went wrong joining. Please try again.';
    els.joinPanelBtn.disabled = false;
    els.joinPanelBtn.textContent = 'Join this lobby';
  }
}

function finalizeSlot(slot) {
  mySlot = slot;
  if (slot === 'p1' || slot === 'p2') {
    localStorage.setItem('aw_last_lobby', JSON.stringify({ code: CODE, slot }));
  }
  els.joinPanel.style.display = 'none';
  attachLobbyListener();
}

function attachLobbyListener() {
  const { onValue, onDisconnect, ref, set } = fb();

  if (mySlot === 'p1' || mySlot === 'p2') {
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
    latestLobby = lobby;
    render(lobby);
    maybeStartGame(lobby);
    if (mySlot === 'p1' || mySlot === 'p2') watchOpponentDisconnect(lobby);
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

  els.guessForm.addEventListener('submit', onSubmitGuess);
  // Mobile fix: tapping the submit button normally steals focus from the
  // text input, which dismisses the on-screen keyboard between guesses.
  // Blocking the button's own focus-grab (it still fires 'click'/'submit'
  // fine) keeps the keyboard up so players can fire off guesses back-to-back
  // without it popping closed and reopening every time.
  const preventFocusSteal = (e) => e.preventDefault();
  els.guessSubmit.addEventListener('mousedown', preventFocusSteal);
  els.guessSubmit.addEventListener('touchstart', preventFocusSteal, { passive: false });
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
  if (!lobby.players?.p1 || !lobby.players?.p2) return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'waiting') return cur;
    if (!cur.players?.p1 || !cur.players?.p2) return cur;
    const now = Date.now();
    const clock = clockSecondsFor(cur);
    cur.status = 'active';
    cur.startedAt = now;
    for (const slot of ['p1', 'p2']) {
      cur.players[slot].baseTime = clock;
      cur.players[slot].baseTimestamp = now;
      cur.players[slot].correct = cur.players[slot].correct || 0;
      cur.players[slot].wrong = cur.players[slot].wrong || 0;
      cur.players[slot].streak = 0;
    }
    return cur;
  });
}

function watchOpponentDisconnect(lobby) {
  if (!isLive(lobby.status)) { if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; } return; }
  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const opp = lobby.players?.[oppSlot];
  if (opp && opp.connected === false && !disconnectTimer) {
    disconnectTimer = setTimeout(() => { reportForfeit(oppSlot); }, 5000);
  } else if (opp && opp.connected !== false && disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

function effectiveTime(player, clockSeconds) {
  if (!player || player.baseTime == null || player.baseTimestamp == null) return clockSeconds || DEFAULT_CLOCK;
  const elapsed = (Date.now() - player.baseTimestamp) / 1000;
  return player.baseTime - elapsed;
}

function computeWinner(cur) {
  const c1 = cur.players?.p1?.correct || 0;
  const c2 = cur.players?.p2?.correct || 0;
  if (c1 > c2) return 'p1';
  if (c2 > c1) return 'p2';
  return 'draw';
}

function bumpSeries(cur, winner) {
  cur.series = cur.series || { wins: { p1: 0, p2: 0 }, draws: 0, round: 1 };
  if (winner === 'draw') cur.series.draws = (cur.series.draws || 0) + 1;
  else if (winner === 'p1' || winner === 'p2') cur.series.wins[winner] = (cur.series.wins[winner] || 0) + 1;
}
function unbumpSeries(cur, winner) {
  if (!cur.series) return;
  if (winner === 'draw') cur.series.draws = Math.max(0, (cur.series.draws || 0) - 1);
  else if (winner === 'p1' || winner === 'p2') cur.series.wins[winner] = Math.max(0, (cur.series.wins[winner] || 0) - 1);
}

function tick() {
  if (!latestLobby) return;
  render(latestLobby);
  if (!isLive(latestLobby.status)) return;

  if (mySlot === 'p1' || mySlot === 'p2') {
    const clock = clockSecondsFor(latestLobby);
    const mine = latestLobby.players?.[mySlot];
    const t = effectiveTime(mine, clock);
    const alreadyDone = latestLobby.doneFlags && latestLobby.doneFlags[mySlot];
    if (t <= 0 && !alreadyDone && !myDoneReported) {
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
    if (cur.doneFlags.p1 && cur.doneFlags.p2) {
      resolveRoundEnd(cur);
    }
    return cur;
  });
}

// Called once both players are done, whether that's the end of the normal
// round or a sudden-death round. If the score is tied and we haven't hit
// the sudden-death round cap yet, kicks off another 20s sudden-death round
// (fresh doneFlags, fresh 20s clocks, streaks cleared) instead of finishing.
function resolveRoundEnd(cur) {
  const winner = computeWinner(cur);
  if (winner === 'draw') {
    const round = (cur.suddenDeathRound || 0) + 1;
    if (round <= MAX_SUDDEN_DEATH_ROUNDS) {
      cur.suddenDeathRound = round;
      cur.status = 'sudden_death';
      cur.doneFlags = {};
      const now = Date.now();
      for (const slot of ['p1', 'p2']) {
        if (!cur.players[slot]) continue;
        cur.players[slot].baseTime = SUDDEN_DEATH_SECONDS;
        cur.players[slot].baseTimestamp = now;
        cur.players[slot].streak = 0;
      }
      return;
    }
  }
  cur.status = 'finished';
  cur.winner = winner;
  cur.finishedAt = Date.now();
  cur.endReason = cur.suddenDeathRound ? 'sudden_death' : 'time';
  bumpSeries(cur, cur.winner);
}

async function reportForfeit(disconnectedSlot) {
  const { runTransaction } = fb();
  const winnerSlot = disconnectedSlot === 'p1' ? 'p2' : 'p1';
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    cur.status = 'finished';
    cur.winner = winnerSlot;
    cur.finishedAt = Date.now();
    cur.endReason = 'forfeit';
    bumpSeries(cur, cur.winner);
    return cur;
  });
}

async function forceEndByCap() {
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    cur.status = 'finished';
    cur.winner = computeWinner(cur);
    cur.finishedAt = Date.now();
    cur.endReason = 'cap';
    bumpSeries(cur, cur.winner);
    return cur;
  });
}

function setDial(slot, seconds, clockSeconds) {
  const frac = Math.max(0, Math.min(1, seconds / clockSeconds));
  const offset = (1 - frac) * CIRC;
  const dial = document.getElementById('dial-' + slot);
  const low = seconds <= Math.min(15, clockSeconds * 0.15);
  dial.style.strokeDashoffset = offset.toFixed(2);
  dial.classList.toggle('low', low);
  document.getElementById('dial-num-' + slot).textContent = formatTime(seconds);
  const timeEl = document.getElementById('time-' + slot);
  timeEl.textContent = formatTime(seconds);
  timeEl.classList.toggle('low', low);
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
    const label = MODE_LABELS[lobby.settings.mode] || 'Classic';
    els.modeBadge.textContent = `${label} · ${clock}s clock`;
    els.modeBadge.style.display = 'inline-block';
  }

  els.waitingPanel.style.display = waiting ? 'block' : 'none';
  els.gamePanel.style.display = active ? 'block' : 'none';
  els.waitingCode.textContent = CODE;

  if (waiting) {
    els.mastheadTitle.textContent = lobby.players?.p2 ? 'Starting…' : 'Waiting for opponent';
    return;
  }

  const amPlayer = mySlot === 'p1' || mySlot === 'p2';
  const amSpectating = mySlot === 'spectator' || mySlot === 'admin';

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

  // Letter-round banner
  if (lobby.settings?.mode === 'letters' && lobby.startedAt) {
    const { letter, secondsLeft } = currentLetterRound(lobby.startedAt);
    els.letterBanner.style.display = 'flex';
    els.letterCurrent.textContent = letter;
    els.letterCountdown.textContent = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else {
    els.letterBanner.style.display = 'none';
  }

  els.suddenDeathBanner.style.display = lobby.status === 'sudden_death' ? 'block' : 'none';

  for (const slot of ['p1', 'p2']) {
    const p = lobby.players?.[slot];
    if (!p) continue;
    document.getElementById('name-' + slot).textContent = p.name || (slot === 'p1' ? 'Player 1' : 'Player 2');
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

  const iAmDone = amPlayer && (myDoneReported || (lobby.doneFlags && lobby.doneFlags[mySlot]));
  const gameOver = lobby.status === 'finished';
  const canGuess = amPlayer && isLive(lobby.status) && !iAmDone;

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
      els.guessInput.placeholder = 'Expedition complete';
    } else if (iAmDone) {
      els.guessInput.placeholder = "You're out of time — waiting on your opponent…";
    } else {
      els.guessInput.placeholder = 'Name an animal…';
    }
  }

  renderLog(lobby);
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
  els.logCount.textContent = `${entries.filter(([, e]) => e.result === 'correct').length} specimens`;
  if (entries.length === 0) {
    els.logList.innerHTML = '<li class="empty-log">No guesses yet — first correct animal starts the log.</li>';
    return;
  }
  els.logList.innerHTML = entries.map(([key, e]) => {
    const wrongCls = e.result === 'wrong' ? ' wrongword' : '';
    const deltaCls = e.delta > 0 ? 'pos' : (e.delta < 0 ? 'neg' : '');
    const deltaText = e.delta > 0 ? `+${e.delta}s` : (e.delta < 0 ? `${e.delta}s` : '±0s');
    const label = resultLabel(e.result, e.word);
    const overturned = e.overturned ? ' <span class="log-overturned">(overturned)</span>' : '';
    let adminBtns = '';
    if (mySlot === 'admin' && e.result !== 'dup') {
      if (e.result !== 'correct') adminBtns += `<button type="button" class="admin-mini-btn" data-logkey="${key}" data-target="correct">Mark correct</button>`;
      if (e.result !== 'wrong') adminBtns += `<button type="button" class="admin-mini-btn" data-logkey="${key}" data-target="wrong">Mark wrong</button>`;
    }
    return `<li>
      <span class="log-tag ${e.slot}">${e.slot === 'p1' ? (lobby.players?.p1?.name || 'P1') : (lobby.players?.p2?.name || 'P2')}</span>
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
  if (mySlot !== 'p1' && mySlot !== 'p2') return;
  const raw = els.guessInput.value;
  if (!raw.trim()) return;
  els.guessInput.value = '';
  // Refocus immediately (synchronously, before the async DB round-trip) so
  // a mobile keyboard that started to close from the tap snaps back open
  // right away instead of visibly closing and reopening.
  els.guessInput.focus();

  const { runTransaction } = fb();
  const canonical = matchAnimal(raw);
  const submittedAt = Date.now();

  const txResult = await runTransaction(lobbyRef, (cur) => {
    if (!cur || !isLive(cur.status)) return cur;
    const mine = cur.players?.[mySlot];
    if (!mine) return cur;
    const clock = clockSecondsFor(cur);
    if (effectiveTime(mine, clock) <= 0) return cur;

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
    } else if (!matchesMode(canonical, cur.settings?.mode, cur.startedAt)) {
      result = 'mode-mismatch';
      delta = 0;
    } else {
      result = 'correct';
      const priorStreak = mine.streak || 0;
      const gap = mine.lastCorrectAt ? (now - mine.lastCorrectAt) / 1000 : Infinity;
      const newStreak = (priorStreak > 0 && gap <= STREAK_WINDOW_S) ? priorStreak + 1 : 1;
      const streakBonus = Math.min(STREAK_BONUS_CAP, newStreak - 1);
      delta = CORRECT_BONUS + streakBonus;
      if (cur.status === 'sudden_death') delta *= 2; // double points in sudden death
      mine.streak = newStreak;
      mine.lastCorrectAt = now;
      mine.correct = (mine.correct || 0) + 1;
      cur.usedAnimals[canonical] = mySlot;
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
    const mineLast = [...entries].reverse().find(en => en.slot === mySlot && en.ts >= submittedAt);
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
    els.feedback.textContent = `Not a recognized animal — ${WRONG_PENALTY}s, streak reset.`;
    els.feedback.classList.add('wrong');
  }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function showResult(lobby) {
  if (resultShownForFinishedAt === lobby.finishedAt) {
    // Already displayed for this finish event; render() still keeps names/scores fresh.
    els.resultOverlay.style.display = 'flex';
    renderRematchState(lobby);
    return;
  }
  resultShownForFinishedAt = lobby.finishedAt;
  els.resultOverlay.style.display = 'flex';
  const p1 = lobby.players?.p1 || {};
  const p2 = lobby.players?.p2 || {};
  els.resultNameP1.textContent = p1.name || 'Player 1';
  els.resultNameP2.textContent = p2.name || 'Player 2';
  els.resultScoreP1.textContent = `${p1.correct || 0}`;
  els.resultScoreP2.textContent = `${p2.correct || 0}`;

  let title;
  if (lobby.winner === 'draw') {
    title = "It's a draw!";
  } else if (lobby.winner === mySlot) {
    title = 'You win! 🏆';
  } else if (lobby.winner === 'p1' || lobby.winner === 'p2') {
    title = `${lobby.winner === 'p1' ? p1.name : p2.name} wins`;
  } else {
    title = 'Expedition complete';
  }
  els.resultTitle.textContent = title;
  if (els.resultSub) {
    els.resultSub.textContent = lobby.endReason === 'forfeit'
      ? 'Decided by forfeit — opponent disconnected.'
      : lobby.endReason === 'sudden_death'
        ? 'Tied after time ran out — decided in sudden death (double points, 20s each).'
        : 'Decided by total animals named.';
  }

  const amPlayer = mySlot === 'p1' || mySlot === 'p2';
  els.rematchRowPlayer.style.display = amPlayer ? 'flex' : 'none';
  els.rematchRowSpectator.style.display = amPlayer ? 'none' : 'block';

  renderRematchState(lobby);
}

function renderRematchState(lobby) {
  const s = lobby.series || { wins: { p1: 0, p2: 0 }, draws: 0, round: 1 };
  const p1 = lobby.players?.p1 || {};
  const p2 = lobby.players?.p2 || {};
  els.seriesRow.innerHTML =
    `<span>Round ${s.round || 1}</span>` +
    `<span><strong>${p1.name || 'P1'}</strong> ${s.wins?.p1 || 0}</span>` +
    `<span>Draws ${s.draws || 0}</span>` +
    `<span><strong>${p2.name || 'P2'}</strong> ${s.wins?.p2 || 0}</span>`;

  const amPlayer = mySlot === 'p1' || mySlot === 'p2';
  if (!amPlayer) return;

  const votes = lobby.rematchVotes || {};
  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const oppName = (lobby.players?.[oppSlot]?.name) || 'Opponent';

  if (votes[oppSlot] === false) {
    els.rematchStatus.textContent = `${oppName} chose not to rematch.`;
    els.rematchYesBtn.disabled = true;
  } else if (votes[mySlot] === true) {
    els.rematchStatus.textContent = `Waiting for ${oppName} to respond…`;
    els.rematchYesBtn.disabled = true;
  } else {
    els.rematchStatus.textContent = '';
    els.rematchYesBtn.disabled = false;
  }
}

async function castRematchVote(vote) {
  if (mySlot !== 'p1' && mySlot !== 'p2') return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'finished') return cur;
    cur.rematchVotes = cur.rematchVotes || {};
    cur.rematchVotes[mySlot] = vote;
    if (vote === true && cur.rematchVotes.p1 === true && cur.rematchVotes.p2 === true) {
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
  cur.series = cur.series || { wins: { p1: 0, p2: 0 }, draws: 0, round: 1 };
  cur.series.round = (cur.series.round || 1) + 1;
  for (const slot of ['p1', 'p2']) {
    if (!cur.players[slot]) continue;
    cur.players[slot].baseTime = clock;
    cur.players[slot].baseTimestamp = now;
    cur.players[slot].correct = 0;
    cur.players[slot].wrong = 0;
    cur.players[slot].streak = 0;
    delete cur.players[slot].lastCorrectAt;
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
      const newWinner = computeWinner(cur);
      if (newWinner !== cur.winner) {
        unbumpSeries(cur, cur.winner);
        bumpSeries(cur, newWinner);
        cur.winner = newWinner;
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
    if (cur.status === 'finished' && cur.endReason !== 'forfeit') {
      unbumpSeries(cur, cur.winner);
      cur.status = cur.endReason === 'sudden_death' ? 'sudden_death' : 'active';
      cur.winner = null;
      cur.finishedAt = null;
    }
  }
}
