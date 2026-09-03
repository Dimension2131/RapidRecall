function getClientId() {
  let id = localStorage.getItem('aw_client_id');
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('aw_client_id', id);
  }
  return id;
}

function getSavedUsername() {
  return localStorage.getItem('aw_username') || '';
}

function saveUsername(name) {
  localStorage.setItem('aw_username', name);
}

function generateLobbyCode() {
  const n = Math.floor(Math.random() * 1000000);
  return n.toString().padStart(6, '0');
}

function normalizeGuess(raw, opts) {
  opts = opts || {};
  let s = (raw || '').toLowerCase().trim();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // fold accents
  s = s.replace(/-/g, ' ');
  s = s.replace(/\./g, '');
  s = s.replace(/\s+/g, ' ');
  if (opts.stripArticle) {
    s = s.replace(/^(a|an|the)\s+/, '');
  }
  s = s.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  return s;
}

const IRREGULAR_PLURALS = {
  goose: 'geese', mouse: 'mice', louse: 'lice', ox: 'oxen',
  child: 'children', person: 'people', tooth: 'teeth', foot: 'feet',
  octopus: 'octopuses', cactus: 'cacti', fungus: 'fungi',
  criterion: 'criteria', phenomenon: 'phenomena',
};
const IRREGULAR_REVERSE = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([sing, plur]) => [plur, sing])
);
IRREGULAR_REVERSE['octopi'] = 'octopus'; 

function candidateForms(norm) {
  const forms = new Set([norm]);
  if (IRREGULAR_PLURALS[norm]) forms.add(IRREGULAR_PLURALS[norm]);
  if (IRREGULAR_REVERSE[norm]) forms.add(IRREGULAR_REVERSE[norm]);
  if (norm.endsWith('ies') && norm.length > 3) forms.add(norm.slice(0, -3) + 'y');
  if (norm.endsWith('ves') && norm.length > 3) {
    forms.add(norm.slice(0, -3) + 'f');
    forms.add(norm.slice(0, -3) + 'fe');
  }
  if (norm.endsWith('es') && norm.length > 2) forms.add(norm.slice(0, -2));
  if (norm.endsWith('s') && norm.length > 1) forms.add(norm.slice(0, -1));
  forms.add(norm + 's');
  return Array.from(forms);
}

function matchAnimal(raw) {
  const norm = normalizeGuess(raw, { stripArticle: true });
  if (!norm) return null;
  for (const form of candidateForms(norm)) {
    if (window.ANIMAL_SET.has(form)) return form;
  }
  return null;
}

function matchInSet(raw, set) {
  if (!set) return null;
  const norm = normalizeGuess(raw, { stripArticle: false });
  if (!norm) return null;
  return set.has(norm) ? norm : null;
}

function isPokemonMode(mode) { return typeof mode === 'string' && mode.indexOf('pokemon') === 0; }

function matchForMode(raw, mode, settings) {
  if (mode === 'combo') {
    const cats = (settings && settings.comboCategories) || [];
    for (const cat of cats) {
      const m = matchForMode(raw, cat);
      if (m) return m;
    }
    return null;
  }
  if (mode === 'nba') return matchInSet(raw, window.NBA_PLAYERS);
  if (mode === 'football') return matchInSet(raw, window.FOOTBALL_PLAYERS);
  if (mode === 'countries') return matchInSet(raw, window.COUNTRIES);
  if (mode === 'movies') return matchInSet(raw, window.MOVIES);
  if (mode === 'tv_shows') return matchInSet(raw, window.TV_SHOWS);
  if (mode === 'artists') return matchInSet(raw, window.ARTISTS);
  if (mode === 'actors') return matchInSet(raw, window.ACTORS);
  if (mode === 'superheroes') return matchInSet(raw, window.SUPERHEROES);
  if (mode === 'cars') return matchInSet(raw, window.CARS);
  if (mode === 'food_drinks') return matchInSet(raw, window.FOOD_DRINKS);
  if (isPokemonMode(mode)) return matchInSet(raw, window.POKEMON_SET);
  return matchAnimal(raw);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

// ---------------- Game modes ----------------
const COMBO_BASE_CATEGORIES = [
  'classic', 'nba', 'football', 'countries', 'movies', 'tv_shows',
  'artists', 'actors', 'superheroes', 'cars', 'food_drinks', 'pokemon_classic',
];

const COMBO_CATEGORY_LABELS = {
  classic: 'Animals', nba: 'NBA', football: 'Football', countries: 'Countries',
  movies: 'Movies', tv_shows: 'TV Shows', artists: 'Artists', actors: 'Actors',
  superheroes: 'Superheroes', cars: 'Cars', food_drinks: 'Food & Drinks',
  pokemon_classic: 'Pok\u00e9mon',
};

const MODE_LABELS = {
  classic: 'Classic (all animals)',
  mammals: 'Mammals only',
  birds: 'Birds only',
  ocean: 'Ocean animals only',
  dinosaurs: 'Dinosaurs only',
  letters: 'Letter-locked (rotates every 20s)',
  chain: 'Chain (start with the last letter of your last animal)',
  lengthlock: 'Length-locked (exact letter count)',
  nba: 'NBA Players (all-time)',
  football: 'Football Players (all-time)',
  countries: 'Countries',
  movies: 'Movies',
  tv_shows: 'TV Shows',
  artists: 'Artists (musicians/bands)',
  actors: 'Actors',
  superheroes: 'Superheroes (Marvel, DC & more)',
  cars: 'Cars',
  food_drinks: 'Food & Drinks',
  pokemon_classic: 'Pok\u00e9mon: Classic (all Pok\u00e9mon)',
  pokemon_stage: 'Pok\u00e9mon: Stages',
  pokemon_legendary: 'Pok\u00e9mon: Legendary/Mythical/Ultra Beast',
  pokemon_type: 'Pok\u00e9mon: Certain type',
  pokemon_gen: 'Pok\u00e9mon: Certain generation',
  pokemon_gen_locked: 'Pok\u00e9mon: Generation-locked (rotates every 20s)',
  pokemon_type_locked: 'Pok\u00e9mon: Type-locked (rotates every 20s)',
  pokemon_letters: 'Pok\u00e9mon: Letter-locked',
  pokemon_chain: 'Pok\u00e9mon: Chain',
  combo: 'Combo Category',
};

const MYSTERY_POOL = [
  'classic', 'mammals', 'birds', 'ocean', 'dinosaurs',
  'nba', 'football', 'countries', 'movies', 'tv_shows',
  'artists', 'actors', 'superheroes', 'cars', 'food_drinks',
  'pokemon_classic', 'pokemon_legendary',
];

function rollMysteryMode() {
  return MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)];
}

function seededSequence(seed, items) {
  const arr = items.slice();
  let s = seed >>> 0;
  function rand() {
    // mulberry32
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seededLetterSequence(seed) {
  return seededSequence(seed, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
}

const ROTATE_ROUND_SECONDS = 20;
const LETTER_ROUND_SECONDS = ROTATE_ROUND_SECONDS;

function currentRotation(startedAt, items) {
  const seq = seededSequence(startedAt || 0, items);
  const elapsed = Math.max(0, (Date.now() - (startedAt || Date.now())) / 1000);
  const idx = Math.floor(elapsed / ROTATE_ROUND_SECONDS) % seq.length;
  const into = elapsed % ROTATE_ROUND_SECONDS;
  return { value: seq[idx], secondsLeft: Math.ceil(ROTATE_ROUND_SECONDS - into) };
}

function currentLetterRound(startedAt) {
  const { value, secondsLeft } = currentRotation(startedAt, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
  return { letter: value, secondsLeft };
}

const POKEMON_GEN_LIST = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const POKEMON_TYPE_LIST = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy',
];

function currentGenRound(startedAt) {
  const { value, secondsLeft } = currentRotation(startedAt, POKEMON_GEN_LIST);
  return { gen: value, secondsLeft };
}
function currentTypeRound(startedAt) {
  const { value, secondsLeft } = currentRotation(startedAt, POKEMON_TYPE_LIST);
  return { type: value, secondsLeft };
}

function matchesMode(canonical, mode, startedAt) {
  mode = mode || 'classic';
  if (mode === 'classic' || mode === 'nba' || mode === 'football' ||
      mode === 'countries' || mode === 'movies' || mode === 'tv_shows' ||
      mode === 'artists' || mode === 'actors' || mode === 'superheroes' ||
      mode === 'cars' || mode === 'food_drinks' || mode === 'combo') {
    return true;
  }
  if (mode === 'letters') {
    const { letter } = currentLetterRound(startedAt);
    return canonical.charAt(0).toUpperCase() === letter;
  }
  const set = window.CATEGORY_SETS && window.CATEGORY_SETS[mode];
  return set ? set.has(canonical) : true;
}

function matchesPokemonMode(canonical, mode, settings) {
  if (mode === 'pokemon_classic') return true;
  const meta = window.POKEMON_META && window.POKEMON_META[canonical];
  if (!meta) return false; // shouldn't happen -- POKEMON_SET and POKEMON_META share keys
  if (mode === 'pokemon_stage') return meta.stage === (settings && settings.pokemonStage);
  if (mode === 'pokemon_legendary') return !!meta.special;
  if (mode === 'pokemon_type') return (meta.types || []).includes((settings && settings.pokemonType) || '');
  if (mode === 'pokemon_gen') return meta.gen === (settings && settings.pokemonGen);
  if (mode === 'pokemon_gen_locked') {
    const { gen } = currentGenRound(settings && settings.startedAt);
    return meta.gen === gen;
  }
  if (mode === 'pokemon_type_locked') {
    const { type } = currentTypeRound(settings && settings.startedAt);
    return (meta.types || []).includes(type);
  }
  return true;
}

function passesPlayerConstraint(canonical, mode, player, settings) {
  if (mode === 'chain' || mode === 'pokemon_chain') {
    if (!player || !player.chainLetter) return true;
    return canonical.charAt(0).toUpperCase() === player.chainLetter;
  }
  if (mode === 'lengthlock') {
    const required = (settings && settings.requiredLength) || 5;
    const bare = canonical.replace(/\s+/g, '');
    return bare.length === required;
  }
  if (mode === 'pokemon_letters') {
    const { letter } = currentLetterRound(settings && settings.startedAt);
    return canonical.charAt(0).toUpperCase() === letter;
  }
  if (isPokemonMode(mode)) {
    return matchesPokemonMode(canonical, mode, settings);
  }
  return matchesMode(canonical, mode, settings && settings.startedAt);
}
