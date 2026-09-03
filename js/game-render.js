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
      label = `Pok\u00e9mon: ${capitalize(lobby.settings.pokemonType)} type`;
    } else if (lobby.settings.mode === 'pokemon_gen' && lobby.settings.pokemonGen) {
      label = `Pok\u00e9mon: Generation ${lobby.settings.pokemonGen}`;
    } else if (lobby.settings.mode === 'pokemon_stage' && lobby.settings.pokemonStage) {
      const stageLabels = { basic: 'Basic', stage1: 'Stage 1', stage2: 'Stage 2 / Final' };
      label = `Pok\u00e9mon: ${stageLabels[lobby.settings.pokemonStage] || lobby.settings.pokemonStage}`;
    } else if (lobby.settings.mode === 'combo' && lobby.settings.comboCategories) {
      const mysterySlots = lobby.settings.comboMysterySlots || [];
      const parts = lobby.settings.comboCategories.map((cat, i) => {
        const name = COMBO_CATEGORY_LABELS[cat] || cat;
        return mysterySlots.includes(i) ? `Mystery\u2192${name}` : name;
      });
      label = `Combo: ${parts.join(' + ')}`;
    }
    const prefix = lobby.settings.wasMystery ? 'Mystery \u2192 ' : '';
    els.modeBadge.textContent = `${prefix}${label} · ${clock}s clock`;
    els.modeBadge.style.display = 'inline-block';
    const loadKey = lobby.settings.mode === 'combo'
      ? 'combo:' + (lobby.settings.comboCategories || []).join(',')
      : lobby.settings.mode;
    if (dictionaryLoadingFor !== loadKey) {
      ensureDictionaryLoaded(lobby.settings.mode, lobby.settings);
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

  if ((lobby.settings?.mode === 'letters' || lobby.settings?.mode === 'pokemon_letters') && lobby.startedAt) {
    const { letter, secondsLeft } = currentLetterRound(lobby.startedAt);
    els.letterBanner.style.display = 'flex';
    els.letterCurrent.textContent = letter;
    els.letterCountdown.textContent = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else {
    els.letterBanner.style.display = 'none';
  }

  if (lobby.settings?.mode === 'pokemon_gen_locked' && lobby.startedAt) {
    const { gen, secondsLeft } = currentGenRound(lobby.startedAt);
    els.pokemonGenBanner.style.display = 'flex';
    els.pokemonGenCurrent.textContent = gen;
    els.pokemonGenCountdown.textContent = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else {
    els.pokemonGenBanner.style.display = 'none';
  }

  if (lobby.settings?.mode === 'pokemon_type_locked' && lobby.startedAt) {
    const { type, secondsLeft } = currentTypeRound(lobby.startedAt);
    els.pokemonTypeBanner.style.display = 'flex';
    els.pokemonTypeCurrent.textContent = capitalize(type);
    els.pokemonTypeCountdown.textContent = lobby.status === 'finished' ? '' : `(next in ${secondsLeft}s)`;
  } else {
    els.pokemonTypeBanner.style.display = 'none';
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
      els.guessInput.placeholder = `Name a${/^[aeiou]/i.test(modeNoun(lobby.settings?.mode, lobby.settings)) ? 'n' : ''} ${modeNoun(lobby.settings?.mode, lobby.settings)}…`;
    }
  }

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

