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
const pokemonSubmodes = document.getElementById('pokemon-submodes');
const lengthlockConfig = document.getElementById('lengthlock-config');
const lengthInput = document.getElementById('length-input');
const pokemonTypePicker = document.getElementById('pokemon-type-picker');
const pokemonGenPicker = document.getElementById('pokemon-gen-picker');
const pokemonStagePicker = document.getElementById('pokemon-stage-picker');
const typeGrid = document.getElementById('type-grid');
const genGrid = document.getElementById('gen-grid');
const stageGrid = document.getElementById('stage-grid');
let selectedPokemonType = 'fire';
let selectedPokemonGen = 1;
let selectedPokemonStage = 'basic';
const comboSubmodes = document.getElementById('combo-submodes');
const comboPick3Label = document.getElementById('combo-pick-3-label');
const comboPick3 = document.getElementById('combo-pick-3');
const comboErrorEl = document.getElementById('combo-error');
const comboSelects = [
  document.getElementById('combo-pick-1'),
  document.getElementById('combo-pick-2'),
  document.getElementById('combo-pick-3'),
];

document.querySelectorAll('input[name="category"]').forEach((el) => {
  el.addEventListener('change', () => {
    const val = document.querySelector('input[name="category"]:checked')?.value;
    animalsSubmodes.style.display = val === 'animals' ? 'block' : 'none';
    sportsSubmodes.style.display = val === 'sports' ? 'block' : 'none';
    pokemonSubmodes.style.display = val === 'pokemon' ? 'block' : 'none';
    comboSubmodes.style.display = val === 'combo' ? 'block' : 'none';
  });
});
document.querySelectorAll('input[name="mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const val = document.querySelector('input[name="mode"]:checked')?.value;
    lengthlockConfig.style.display = val === 'lengthlock' ? 'block' : 'none';
  });
});
document.querySelectorAll('input[name="pokemon_mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const val = document.querySelector('input[name="pokemon_mode"]:checked')?.value;
    pokemonTypePicker.style.display = val === 'pokemon_type' ? 'block' : 'none';
    pokemonGenPicker.style.display = val === 'pokemon_gen' ? 'block' : 'none';
    pokemonStagePicker.style.display = val === 'pokemon_stage' ? 'block' : 'none';
  });
});

typeGrid.querySelectorAll('.type-badge').forEach((badge) => {
  badge.addEventListener('click', () => {
    typeGrid.querySelectorAll('.type-badge').forEach((b) => b.classList.remove('selected'));
    badge.classList.add('selected');
    selectedPokemonType = badge.dataset.type;
  });
});
typeGrid.querySelector('[data-type="fire"]')?.classList.add('selected');

genGrid.querySelectorAll('.gen-badge').forEach((badge) => {
  badge.addEventListener('click', () => {
    genGrid.querySelectorAll('.gen-badge').forEach((b) => b.classList.remove('selected'));
    badge.classList.add('selected');
    selectedPokemonGen = parseInt(badge.dataset.gen, 10);
  });
});
genGrid.querySelector('[data-gen="1"]')?.classList.add('selected');

stageGrid.querySelectorAll('.gen-badge').forEach((badge) => {
  badge.addEventListener('click', () => {
    stageGrid.querySelectorAll('.gen-badge').forEach((b) => b.classList.remove('selected'));
    badge.classList.add('selected');
    selectedPokemonStage = badge.dataset.stage;
  });
});
stageGrid.querySelector('[data-stage="basic"]')?.classList.add('selected');

const comboOptionsHtml = ['<option value="mystery">Mystery (random)</option>']
  .concat(COMBO_BASE_CATEGORIES.map((c) => `<option value="${c}">${COMBO_CATEGORY_LABELS[c]}</option>`))
  .join('');
comboSelects.forEach((sel) => { sel.innerHTML = comboOptionsHtml; });
comboSelects[0].value = 'classic';
comboSelects[1].value = 'movies';
comboSelects[2].value = 'pokemon_classic';

function updateComboVisibility() {
  const count = parseInt(document.querySelector('input[name="combo_count"]:checked')?.value || '2', 10);
  comboPick3Label.style.display = count === 3 ? 'block' : 'none';
  comboPick3.style.display = count === 3 ? 'block' : 'none';
}
document.querySelectorAll('input[name="combo_count"]').forEach((el) => {
  el.addEventListener('change', updateComboVisibility);
});
updateComboVisibility();

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
  } else if (category === 'pokemon') {
    mode = document.querySelector('input[name="pokemon_mode"]:checked')?.value || 'pokemon_classic';
  } else if (category === 'combo') {
    mode = 'combo';
  } else if (category === 'mystery') {
    mode = rollMysteryMode();
    wasMystery = true;
    if (mode === 'lengthlock') requiredLength = 5;
  } else {
    mode = category;
  }

  let comboCategories = null;
  let comboMysterySlots = null;
  if (mode === 'combo') {
    comboErrorEl.textContent = '';
    const count = parseInt(document.querySelector('input[name="combo_count"]:checked')?.value || '2', 10);
    const picks = comboSelects.slice(0, count).map((sel) => sel.value);

    const explicitPicks = picks.filter((p) => p !== 'mystery');
    if (new Set(explicitPicks).size !== explicitPicks.length) {
      comboErrorEl.textContent = 'Pick a different category for each slot (Mystery can repeat).';
      return;
    }

    comboMysterySlots = [];
    const taken = new Set(explicitPicks);
    comboCategories = picks.map((p, i) => {
      if (p !== 'mystery') return p;
      comboMysterySlots.push(i);
      const pool = COMBO_BASE_CATEGORIES.filter((c) => !taken.has(c));
      const rolled = pool[Math.floor(Math.random() * pool.length)] || COMBO_BASE_CATEGORIES[0];
      taken.add(rolled);
      return rolled;
    });
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
    if (mode === 'pokemon_type') settings.pokemonType = selectedPokemonType;
    if (mode === 'pokemon_gen') settings.pokemonGen = selectedPokemonGen;
    if (mode === 'pokemon_stage') settings.pokemonStage = selectedPokemonStage;
    if (mode === 'combo') {
      settings.comboCategories = comboCategories;
      if (comboMysterySlots && comboMysterySlots.length) settings.comboMysterySlots = comboMysterySlots;
    }
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
  window.location.href = `game.html?code=${code}`;
});

usernameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
joinCodeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
