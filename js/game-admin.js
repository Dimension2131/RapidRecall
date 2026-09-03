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
    if (cur.status === 'finished' && cur.endReason !== 'forfeit' && cur.endReason !== 'admin_ended') {
      unbumpSeries(cur, Array.isArray(cur.winner) ? cur.winner : []);
      cur.status = cur.endReason === 'sudden_death' ? 'sudden_death' : 'active';
      cur.winner = null;
      cur.finishedAt = null;
    }
  }
}
