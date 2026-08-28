// Gameplay: waiting room -> live duel -> result screen.
// Timer model: each player has {baseTime, baseTimestamp}. Effective remaining
// time = baseTime - (now - baseTimestamp)/1000. Every guess resets the anchor
// (new baseTime, baseTimestamp = now), which naturally folds "ticking down in
// real time" and "+2 / -5 adjustments" into one formula with no extra fields.

const TOTAL_TIME = 120;
const CORRECT_BONUS = 2;
const WRONG_PENALTY = 5;
const CIRC = 2 * Math.PI * 34; // 213.6..., matches the SVG r=34 dials

function fb() { return window.__fb; }

const params = new URLSearchParams(window.location.search);
const CODE = (params.get('code') || '').replace(/\D/g, '').slice(0, 6);

const els = {
  codeEyebrow: document.getElementById('code-eyebrow'),
  mastheadTitle: document.getElementById('masthead-title'),
  joinPanel: document.getElementById('join-panel'),
  joinUsername: document.getElementById('join-username'),
  joinPanelError: document.getElementById('join-panel-error'),
  joinPanelBtn: document.getElementById('join-panel-btn'),
  waitingPanel: document.getElementById('waiting-panel'),
  waitingCode: document.getElementById('waiting-code'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  gamePanel: document.getElementById('game-panel'),
  guessForm: document.getElementById('guess-form'),
  guessInput: document.getElementById('guess-input'),
  guessSubmit: document.getElementById('guess-submit'),
  feedback: document.getElementById('feedback'),
  logList: document.getElementById('log-list'),
  logCount: document.getElementById('log-count'),
  resultOverlay: document.getElementById('result-overlay'),
  resultTitle: document.getElementById('result-title'),
  resultNameP1: document.getElementById('result-name-p1'),
  resultNameP2: document.getElementById('result-name-p2'),
  resultScoreP1: document.getElementById('result-score-p1'),
  resultScoreP2: document.getElementById('result-score-p2'),
  rematchBtn: document.getElementById('rematch-btn'),
};

let mySlot = null;       // 'p1' | 'p2'
let myClientId = null;
let lobbyRef = null;
let latestLobby = null;  // last snapshot from onValue
let tickHandle = null;
let myTimeoutReported = false;
let disconnectTimer = null;

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
// In case firebase-init.js already fired before we attached the listener
// (module scripts execute in document order, so normally this won't race,
// but this is a harmless safety net).
if (window.__fb) init();

async function init() {
  const { db, ref } = fb();
  lobbyRef = ref(db, 'lobbies/' + CODE);
  myClientId = getClientId();

  const saved = JSON.parse(localStorage.getItem('aw_last_lobby') || 'null');
  if (saved && saved.code === CODE && (saved.slot === 'p1' || saved.slot === 'p2')) {
    mySlot = saved.slot;
    attachLobbyListener();
    return;
  }

  // Not recognized locally (e.g. opened a shared link directly) -> ask for a name and join.
  els.joinPanel.style.display = 'block';
  els.joinUsername.value = getSavedUsername();
  els.joinPanelBtn.addEventListener('click', attemptDirectJoin);
  els.joinUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptDirectJoin(); });
}

async function attemptDirectJoin() {
  const name = els.joinUsername.value.trim();
  if (!name) { els.joinPanelError.textContent = 'Enter a name first.'; return; }
  saveUsername(name);
  els.joinPanelBtn.disabled = true;
  els.joinPanelBtn.textContent = 'Joining…';
  try {
    const { get, runTransaction, ref, db } = fb();
    const snap = await get(lobbyRef);
    if (!snap.exists()) {
      els.joinPanelError.textContent = 'No lobby found with that code.';
      els.joinPanelBtn.disabled = false;
      els.joinPanelBtn.textContent = 'Join this lobby';
      return;
    }
    const lobby = snap.val();
    if (lobby.players?.p1?.clientId === myClientId) {
      mySlot = 'p1';
    } else if (lobby.players?.p2?.clientId === myClientId) {
      mySlot = 'p2';
    } else if (lobby.players?.p1 && lobby.players?.p2) {
      els.joinPanelError.textContent = 'That lobby already has two players.';
      els.joinPanelBtn.disabled = false;
      els.joinPanelBtn.textContent = 'Join this lobby';
      return;
    } else {
      const p2Ref = ref(db, `lobbies/${CODE}/players/p2`);
      const result = await runTransaction(p2Ref, (current) => {
        if (current) return;
        return { name, clientId: myClientId, connected: true, correct: 0, wrong: 0 };
      });
      if (!result.committed) {
        els.joinPanelError.textContent = 'That lobby already has two players.';
        els.joinPanelBtn.disabled = false;
        els.joinPanelBtn.textContent = 'Join this lobby';
        return;
      }
      mySlot = 'p2';
    }
    localStorage.setItem('aw_last_lobby', JSON.stringify({ code: CODE, slot: mySlot }));
    els.joinPanel.style.display = 'none';
    attachLobbyListener();
  } catch (err) {
    console.error(err);
    els.joinPanelError.textContent = 'Something went wrong joining. Please try again.';
    els.joinPanelBtn.disabled = false;
    els.joinPanelBtn.textContent = 'Join this lobby';
  }
}

function attachLobbyListener() {
  const { onValue, onDisconnect, ref, set } = fb();

  // Mark myself present, and tidy up if this tab closes.
  const connFlagRef = ref(fb().db, `lobbies/${CODE}/players/${mySlot}/connected`);
  set(connFlagRef, true).catch(() => {});
  onDisconnect(connFlagRef).set(false);

  onValue(lobbyRef, (snap) => {
    if (!snap.exists()) {
      els.mastheadTitle.textContent = 'Lobby closed';
      return;
    }
    const lobby = snap.val();
    latestLobby = lobby;
    render(lobby);
    maybeStartGame(lobby);
    watchOpponentDisconnect(lobby);
    if (lobby.status === 'finished') {
      showResult(lobby);
    }
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
  els.rematchBtn.addEventListener('click', () => { window.location.href = 'index.html'; });

  if (!tickHandle) tickHandle = setInterval(tick, 100);
}

// Whoever notices both players present flips status waiting -> active exactly once.
async function maybeStartGame(lobby) {
  if (lobby.status !== 'waiting') return;
  if (!lobby.players?.p1 || !lobby.players?.p2) return;
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'waiting') return cur;
    if (!cur.players?.p1 || !cur.players?.p2) return cur;
    const now = Date.now();
    cur.status = 'active';
    cur.startedAt = now;
    cur.players.p1.baseTime = TOTAL_TIME;
    cur.players.p1.baseTimestamp = now;
    cur.players.p1.correct = cur.players.p1.correct || 0;
    cur.players.p1.wrong = cur.players.p1.wrong || 0;
    cur.players.p2.baseTime = TOTAL_TIME;
    cur.players.p2.baseTimestamp = now;
    cur.players.p2.correct = cur.players.p2.correct || 0;
    cur.players.p2.wrong = cur.players.p2.wrong || 0;
    return cur;
  });
}

function watchOpponentDisconnect(lobby) {
  if (lobby.status !== 'active') { if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; } return; }
  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const opp = lobby.players?.[oppSlot];
  if (opp && opp.connected === false && !disconnectTimer) {
    disconnectTimer = setTimeout(() => {
      reportTimeout(oppSlot);
    }, 5000);
  } else if (opp && opp.connected !== false && disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

function effectiveTime(player) {
  if (!player || player.baseTime == null || player.baseTimestamp == null) return TOTAL_TIME;
  const elapsed = (Date.now() - player.baseTimestamp) / 1000;
  return player.baseTime - elapsed;
}

function tick() {
  if (!latestLobby) return;
  render(latestLobby);
  if (latestLobby.status === 'active') {
    const mine = latestLobby.players?.[mySlot];
    const t = effectiveTime(mine);
    if (t <= 0 && !myTimeoutReported) {
      myTimeoutReported = true;
      reportTimeout(mySlot);
    }
  }
}

async function reportTimeout(slotThatRanOut) {
  const { runTransaction } = fb();
  await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'active') return cur;
    cur.timeoutReported = cur.timeoutReported || {};
    cur.timeoutReported[slotThatRanOut] = true;
    const p1out = !!cur.timeoutReported.p1;
    const p2out = !!cur.timeoutReported.p2;
    if (p1out || p2out) {
      cur.status = 'finished';
      cur.winner = (p1out && p2out) ? 'draw' : (p1out ? 'p2' : 'p1');
      cur.finishedAt = Date.now();
    }
    return cur;
  });
}

function setDial(slot, seconds) {
  const frac = Math.max(0, Math.min(1, seconds / TOTAL_TIME));
  const offset = (1 - frac) * CIRC;
  const dial = document.getElementById('dial-' + slot);
  const low = seconds <= 15;
  dial.style.strokeDashoffset = offset.toFixed(2);
  dial.classList.toggle('low', low);
  document.getElementById('dial-num-' + slot).textContent = formatTime(seconds);
  const timeEl = document.getElementById('time-' + slot);
  timeEl.textContent = formatTime(seconds);
  timeEl.classList.toggle('low', low);
}

function render(lobby) {
  const waiting = lobby.status === 'waiting';
  const active = lobby.status === 'active' || lobby.status === 'finished';

  els.waitingPanel.style.display = waiting ? 'block' : 'none';
  els.gamePanel.style.display = active ? 'block' : 'none';
  els.waitingCode.textContent = CODE;

  if (waiting) {
    els.mastheadTitle.textContent = lobby.players?.p2 ? 'Starting…' : 'Waiting for opponent';
    return;
  }

  els.mastheadTitle.textContent = lobby.status === 'finished' ? 'Duel finished' : 'Duel in progress';

  for (const slot of ['p1', 'p2']) {
    const p = lobby.players?.[slot];
    if (!p) continue;
    document.getElementById('name-' + slot).textContent = p.name || (slot === 'p1' ? 'Player 1' : 'Player 2');
    document.getElementById('you-tag-' + slot).style.display = slot === mySlot ? 'inline-block' : 'none';
    document.getElementById('panel-' + slot).classList.toggle('is-you', slot === mySlot);
    document.getElementById('panel-' + slot).classList.toggle('disconnected', p.connected === false);
    document.getElementById('counts-' + slot).textContent = `${p.correct || 0} correct · ${p.wrong || 0} wrong`;
    setDial(slot, Math.max(0, effectiveTime(p)));
  }

  const iAmOut = myTimeoutReported || (lobby.timeoutReported && lobby.timeoutReported[mySlot]);
  const gameOver = lobby.status === 'finished';
  const canGuess = lobby.status === 'active' && !iAmOut;
  els.guessInput.disabled = !canGuess;
  els.guessSubmit.disabled = !canGuess;
  if (gameOver) {
    els.guessInput.placeholder = 'Expedition complete';
  } else if (iAmOut) {
    els.guessInput.placeholder = "You're out of time";
  } else {
    els.guessInput.placeholder = 'Name an animal…';
  }

  renderLog(lobby);
}

function renderLog(lobby) {
  const entries = Object.values(lobby.log || {}).sort((a, b) => a.ts - b.ts);
  els.logCount.textContent = `${entries.filter(e => e.result === 'correct').length} specimens`;
  if (entries.length === 0) {
    els.logList.innerHTML = '<li class="empty-log">No guesses yet — first correct animal starts the log.</li>';
    return;
  }
  els.logList.innerHTML = entries.map((e) => {
    const wrongCls = e.result === 'wrong' ? ' wrongword' : '';
    const deltaCls = e.delta > 0 ? 'pos' : (e.delta < 0 ? 'neg' : '');
    const deltaText = e.delta > 0 ? `+${e.delta}s` : (e.delta < 0 ? `${e.delta}s` : '±0s');
    const label = e.result === 'dup' ? `${e.word} (already used)` : e.word;
    return `<li>
      <span class="log-tag ${e.slot}">${e.slot === 'p1' ? (lobby.players?.p1?.name || 'P1') : (lobby.players?.p2?.name || 'P2')}</span>
      <span class="log-word${wrongCls}">${escapeHtml(label)}</span>
      <span class="log-delta ${deltaCls}">${deltaText}</span>
    </li>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function onSubmitGuess(e) {
  e.preventDefault();
  const raw = els.guessInput.value;
  if (!raw.trim()) return;
  els.guessInput.value = '';

  const { runTransaction } = fb();
  const canonical = matchAnimal(raw);
  const submittedAt = Date.now();

  const txResult = await runTransaction(lobbyRef, (cur) => {
    if (!cur || cur.status !== 'active') return cur;
    const mine = cur.players?.[mySlot];
    if (!mine) return cur;
    if (effectiveTime(mine) <= 0) return cur; // already out, ignore

    cur.usedAnimals = cur.usedAnimals || {};
    let result, delta;
    if (!canonical) {
      result = 'wrong'; delta = -WRONG_PENALTY;
    } else if (cur.usedAnimals[canonical]) {
      result = 'dup'; delta = 0;
    } else {
      result = 'correct'; delta = CORRECT_BONUS;
      cur.usedAnimals[canonical] = mySlot;
    }

    const now = Date.now();
    const curTime = effectiveTime(mine);
    mine.baseTime = curTime + delta;
    mine.baseTimestamp = now;
    if (result === 'correct') mine.correct = (mine.correct || 0) + 1;
    if (result === 'wrong') mine.wrong = (mine.wrong || 0) + 1;
    cur.players[mySlot] = mine;

    cur.log = cur.log || {};
    const logKey = 'l' + now + '_' + Math.floor(Math.random() * 100000);
    cur.log[logKey] = {
      slot: mySlot,
      word: canonical || normalizeGuess(raw) || raw.trim(),
      result, delta, ts: now
    };

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
    els.feedback.textContent = `✓ ${capitalize(entry.word)} — +${entry.delta}s`;
    els.feedback.classList.add('correct');
  } else if (entry.result === 'dup') {
    els.feedback.textContent = `${capitalize(entry.word)} was already guessed.`;
    els.feedback.classList.add('dup');
  } else {
    els.feedback.textContent = `Not a recognized animal — ${WRONG_PENALTY}s.`;
    els.feedback.classList.add('wrong');
  }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function showResult(lobby) {
  if (els.resultOverlay.style.display === 'flex') return;
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
}
