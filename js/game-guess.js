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
    const noun = modeNoun(latestLobby?.settings?.mode, latestLobby?.settings);
    els.feedback.textContent = `Not a recognized ${noun} — ${WRONG_PENALTY}s, streak reset.`;
    els.feedback.classList.add('wrong');
  }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

