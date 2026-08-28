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
 *  lowercase, trim, collapse internal whitespace, drop a leading article,
 *  strip surrounding punctuation. */
function normalizeGuess(raw) {
  let s = (raw || '').toLowerCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^(a|an|the)\s+/, '');
  s = s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
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

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
