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

