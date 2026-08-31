// Home screen: create a lobby or join one by code.
// Waits for firebase-init.js (loaded just before this) to have populated window.__fb.

function fb() { return window.__fb; }

const usernameEl = document.getElementById('username');
const nameErrorEl = document.getElementById('name-error');
const createBtn = document.getElementById('create-btn');
const setupPanel = document.getElementById('setup-panel');
const setupErrorEl = document.getElementById('setup-error');
const setupConfirmBtn = document.getElementById('setup-confirm-btn');
const setupBackBtn = document.getElementById('setup-back-btn');
const joinCodeEl = document.getElementById('join-code');
const joinErrorEl = document.getElementById('join-error');
const joinBtn = document.getElementById('join-btn');
const dictCountEl = document.getElementById('dict-count');
const animalsSubmodes = document.getElementById('animals-submodes');
const sportsSubmodes = document.getElementById('sports-submodes');
const lengthlockConfig = document.getElementById('lengthlock-config');
const lengthInput = document.getElementById('length-input');

// Top-level category -> sub-picker visibility, since Animals and Sports are
// the only two categories with further sub-modes (per the request that
// grouped NBA/Football under Sports and the animal variants under Animals;
// every other category is a single flat dictionary with no sub-choice).
document.querySelectorAll('input[name="category"]').forEach((el) => {
  el.addEventListener('change', () => {
    const val = document.querySelector('input[name="category"]:checked')?.value;
    animalsSubmodes.style.display = val === 'animals' ? 'block' : 'none';
    sportsSubmodes.style.display = val === 'sports' ? 'block' : 'none';
  });
});
document.querySelectorAll('input[name="mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const val = document.querySelector('input[name="mode"]:checked')?.value;
    lengthlockConfig.style.display = val === 'lengthlock' ? 'block' : 'none';
  });
});

usernameEl.value = getSavedUsername();
if (window.ANIMAL_SET) {
  dictCountEl.textContent = `Verifier dictionary loaded: ${window.ANIMAL_SET.size.toLocaleString()} real animal names.`;
}

joinCodeEl.addEventListener('input', () => {
  joinCodeEl.value = joinCodeEl.value.replace(/\D/g, '').slice(0, 6);
});

function requireUsername() {
  const name = usernameEl.value.trim();
  if (!name) {
    nameErrorEl.textContent = 'Enter a name first.';
    usernameEl.focus();
    return null;
  }
  if (name.length > 18) {
    nameErrorEl.textContent = 'Keep it under 18 characters.';
    return null;
  }
  nameErrorEl.textContent = '';
  saveUsername(name);
  return name;
}

async function findFreeCode() {
  const { db, ref, get } = fb();
  for (let i = 0; i < 12; i++) {
    const code = generateLobbyCode();
    const snap = await get(ref(db, 'lobbies/' + code));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not allocate a lobby code, please try again.');
}

createBtn.addEventListener('click', () => {
  const name = requireUsername();
  if (!name) return;
  createBtn.parentElement.style.display = 'none';
  setupPanel.style.display = 'block';
});

setupBackBtn.addEventListener('click', () => {
  setupPanel.style.display = 'none';
  createBtn.parentElement.style.display = 'block';
});

setupConfirmBtn.addEventListener('click', async () => {
  const name = requireUsername();
  if (!name) return;

  const category = document.querySelector('input[name="category"]:checked')?.value || 'animals';
  let mode;
  let wasMystery = false;
  let requiredLength = null;

  if (category === 'animals') {
    mode = document.querySelector('input[name="mode"]:checked')?.value || 'classic';
    if (mode === 'lengthlock') {
      requiredLength = Math.min(15, Math.max(3, parseInt(lengthInput.value, 10) || 5));
    }
  } else if (category === 'sports') {
    mode = document.querySelector('input[name="sport"]:checked')?.value || 'nba';
  } else if (category === 'mystery') {
    mode = rollMysteryMode();
    wasMystery = true;
    if (mode === 'lengthlock') requiredLength = 5; // shouldn't occur (excluded from pool), but stay safe
  } else {
    // countries / movies / tv_shows / artists / actors / superheroes / cars: category value IS the mode key
    mode = category;
  }

  const clockSeconds = parseInt(document.querySelector('input[name="clock"]:checked')?.value || '120', 10);
  const maxPlayers = Math.min(4, Math.max(2, parseInt(document.querySelector('input[name="players"]:checked')?.value || '2', 10)));

  setupConfirmBtn.disabled = true;
  setupConfirmBtn.textContent = 'Creating…';
  try {
    const { db, ref, set, serverTimestamp } = fb();
    const code = await findFreeCode();
    const clientId = getClientId();
    const settings = { mode, clockSeconds, maxPlayers };
    if (wasMystery) settings.wasMystery = true;
    if (requiredLength) settings.requiredLength = requiredLength;
    await set(ref(db, 'lobbies/' + code), {
      createdAt: serverTimestamp(),
      status: 'waiting',
      winner: null,
      usedAnimals: {},
      log: {},
      settings,
      series: { wins: {}, draws: 0, round: 1 },
      players: {
        p1: { name, clientId, connected: true, correct: 0, wrong: 0 }
      }
    });
    localStorage.setItem('aw_last_lobby', JSON.stringify({ code, slot: 'p1' }));
    window.location.href = `game.html?code=${code}`;
  } catch (err) {
    console.error(err);
    setupErrorEl.textContent = 'Could not create a lobby. Check your Firebase setup / connection.';
    setupConfirmBtn.disabled = false;
    setupConfirmBtn.textContent = 'Create lobby & get code';
  }
});

joinBtn.addEventListener('click', () => {
  const name = requireUsername();
  if (!name) return;
  const code = joinCodeEl.value.trim();
  if (code.length !== 6) {
    joinErrorEl.textContent = 'Enter the 6-digit lobby code.';
    return;
  }
  joinErrorEl.textContent = '';
  // All slot/spectator resolution happens on game.html itself, so a
  // reconnect or a spectate-fallback works the same whether someone
  // arrives from this button or opens a shared link directly.
  window.location.href = `game.html?code=${code}`;
});

usernameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
joinCodeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
