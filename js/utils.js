// Shared helpers used by both the home screen and the game screen.

/** Generate a short random client id, persisted per-browser so a page refresh
 *  can reconnect to the same lobby slot instead of registering as a 3rd player. */
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

/** Generate a 6-digit numeric lobby code as a zero-padded string, e.g. "042817". */
function generateLobbyCode() {
  const n = Math.floor(Math.random() * 1000000);
  return n.toString().padStart(6, '0');
}

/** Normalize a raw guess for dictionary + duplicate lookup:
 *  lowercase, trim, fold accents (so "Ümit" and "Umit" match identically --
 *  useful for player names), strip hyphens and periods (so "aye-aye" /
 *  "aye aye" and "A.J." / "AJ" all match identically), collapse whitespace,
 *  drop a leading article, strip surrounding punctuation. */
function normalizeGuess(raw) {
  let s = (raw || '').toLowerCase().trim();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // fold accents
  s = s.replace(/-/g, ' ');
  s = s.replace(/\./g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^(a|an|the)\s+/, '');
  s = s.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  return s;
}

// Common irregular plurals that don't follow a suffix rule, mapped both ways
// so a guess in either form resolves to whichever one the dictionary has.
const IRREGULAR_PLURALS = {
  goose: 'geese', mouse: 'mice', louse: 'lice', ox: 'oxen',
  child: 'children', person: 'people', tooth: 'teeth', foot: 'feet',
  octopus: 'octopuses', cactus: 'cacti', fungus: 'fungi',
  criterion: 'criteria', phenomenon: 'phenomena',
};
const IRREGULAR_REVERSE = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([sing, plur]) => [plur, sing])
);
IRREGULAR_REVERSE['octopi'] = 'octopus'; // alternate plural, in addition to "octopuses"

/** Try a handful of light singular/plural variants so "wolves", "foxes",
 *  "geese", "mice", "sheep" etc. all resolve sensibly against the
 *  dictionary, which stores canonical singular (mostly) forms. */
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
  // also try adding 's' in case dictionary only has the plural headword
  forms.add(norm + 's');
  return Array.from(forms);
}

/** Returns the canonical dictionary form of `raw` if it names a real animal,
 *  otherwise null. Using this canonical form (rather than the raw text) as
 *  the de-duplication key means "wolf" and "wolves" are treated as the same
 *  already-used animal. */
function matchAnimal(raw) {
  const norm = normalizeGuess(raw);
  if (!norm) return null;
  for (const form of candidateForms(norm)) {
    if (window.ANIMAL_SET.has(form)) return form;
  }
  return null;
}

/** Exact-match lookup for name dictionaries (NBA/soccer players) where,
 *  unlike animal names, there's no singular/plural to reconcile -- a full
 *  name either matches an entry or it doesn't. */
function matchInSet(raw, set) {
  if (!set) return null;
  const norm = normalizeGuess(raw);
  if (!norm) return null;
  return set.has(norm) ? norm : null;
}

/** Given a mode key, returns the right verifier function's result for a raw
 *  guess: the matched canonical form, or null if it's not a real entry in
 *  that mode's underlying dictionary. Category/letter modes still draw from
 *  ANIMAL_SET (matchesMode below layers the extra restriction on top);
 *  'nba' and 'soccer' draw from their own separate name dictionaries. */
function matchForMode(raw, mode) {
  if (mode === 'nba') return matchInSet(raw, window.NBA_PLAYERS);
  if (mode === 'football') return matchInSet(raw, window.FOOTBALL_PLAYERS);
  return matchAnimal(raw);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

// ---------------- Game modes ----------------

const MODE_LABELS = {
  classic: 'Classic (all animals)',
  mammals: 'Mammals only',
  birds: 'Birds only',
  ocean: 'Ocean animals only',
  dinosaurs: 'Dinosaurs only',
  letters: 'Letter-locked (rotates every 20s)',
  nba: 'NBA Players (all-time)',
  football: 'Football Players (all-time)',
};

// Deterministic per-round shuffle of A-Z, seeded from the match's start time
// so every client (both players + any spectators/admin) computes the exact
// same letter sequence without needing to sync it through the database.
function seededLetterSequence(seed) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  let s = seed >>> 0;
  function rand() {
    // mulberry32
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

const LETTER_ROUND_SECONDS = 20;

/** Given a match's startedAt timestamp, returns the currently-active letter
 *  for the "letters" mode, plus seconds remaining until it rotates. */
function currentLetterRound(startedAt) {
  const seq = seededLetterSequence(startedAt || 0);
  const elapsed = Math.max(0, (Date.now() - (startedAt || Date.now())) / 1000);
  const idx = Math.floor(elapsed / LETTER_ROUND_SECONDS) % seq.length;
  const into = elapsed % LETTER_ROUND_SECONDS;
  return { letter: seq[idx], secondsLeft: Math.ceil(LETTER_ROUND_SECONDS - into) };
}

function matchesMode(canonical, mode, startedAt) {
  mode = mode || 'classic';
  if (mode === 'classic' || mode === 'nba' || mode === 'football') return true;
  if (mode === 'letters') {
    const { letter } = currentLetterRound(startedAt);
    return canonical.charAt(0).toUpperCase() === letter;
  }
  const set = window.CATEGORY_SETS && window.CATEGORY_SETS[mode];
  return set ? set.has(canonical) : true;
}
