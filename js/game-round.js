function clockSecondsFor(lobby) {
  if (lobby?.status === 'sudden_death') return SUDDEN_DEATH_SECONDS;
  return lobby?.settings?.clockSeconds || DEFAULT_CLOCK;
}

function effectiveTime(player, clockSeconds) {
  if (!player || player.baseTime == null || player.baseTimestamp == null) return clockSeconds || DEFAULT_CLOCK;
  const elapsed = (Date.now() - player.baseTimestamp) / 1000;
  return player.baseTime - elapsed;
}

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
          cur.doneFlags[slot] = true;
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
    if (connected.length > 1) return cur;
    cur.status = 'finished';
    cur.winner = connected;
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

