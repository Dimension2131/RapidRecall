// Home screen: create a lobby or join one by code.
// Waits for firebase-init.js (loaded just before this) to have populated window.__fb.

function fb() { return window.__fb; }

const usernameEl = document.getElementById('username');
const nameErrorEl = document.getElementById('name-error');
const createBtn = document.getElementById('create-btn');
const joinCodeEl = document.getElementById('join-code');
const joinErrorEl = document.getElementById('join-error');
const joinBtn = document.getElementById('join-btn');
const dictCountEl = document.getElementById('dict-count');

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

createBtn.addEventListener('click', async () => {
  const name = requireUsername();
  if (!name) return;
  createBtn.disabled = true;
  createBtn.textContent = 'Creating…';
  try {
    const { db, ref, set, serverTimestamp } = fb();
    const code = await findFreeCode();
    const clientId = getClientId();
    await set(ref(db, 'lobbies/' + code), {
      createdAt: serverTimestamp(),
      status: 'waiting',
      winner: null,
      usedAnimals: {},
      log: {},
      players: {
        p1: {
          name, clientId, connected: true,
          time: 120, correct: 0, wrong: 0
        }
      }
    });
    localStorage.setItem('aw_last_lobby', JSON.stringify({ code, slot: 'p1' }));
    window.location.href = `game.html?code=${code}`;
  } catch (err) {
    console.error(err);
    nameErrorEl.textContent = 'Could not create a lobby. Check your Firebase setup / connection.';
    createBtn.disabled = false;
    createBtn.textContent = 'Create lobby';
  }
});

joinBtn.addEventListener('click', async () => {
  const name = requireUsername();
  if (!name) return;
  const code = joinCodeEl.value.trim();
  if (code.length !== 6) {
    joinErrorEl.textContent = 'Enter the 6-digit lobby code.';
    return;
  }
  joinErrorEl.textContent = '';
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';
  try {
    const { db, ref, get, runTransaction } = fb();
    const lobbyRef = ref(db, 'lobbies/' + code);
    const snap = await get(lobbyRef);
    if (!snap.exists()) {
      joinErrorEl.textContent = 'No lobby found with that code.';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join lobby';
      return;
    }
    const lobby = snap.val();
    const clientId = getClientId();

    // Already part of this lobby (refresh / rejoin case)
    if (lobby.players?.p1?.clientId === clientId) {
      localStorage.setItem('aw_last_lobby', JSON.stringify({ code, slot: 'p1' }));
      window.location.href = `game.html?code=${code}`;
      return;
    }
    if (lobby.players?.p2?.clientId === clientId) {
      localStorage.setItem('aw_last_lobby', JSON.stringify({ code, slot: 'p2' }));
      window.location.href = `game.html?code=${code}`;
      return;
    }

    if (lobby.players?.p1 && lobby.players?.p2) {
      joinErrorEl.textContent = 'That lobby already has two players.';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join lobby';
      return;
    }

    // Claim the p2 slot atomically so two simultaneous joiners can't collide.
    const p2Ref = ref(db, `lobbies/${code}/players/p2`);
    const result = await runTransaction(p2Ref, (current) => {
      if (current) return; // already taken, abort
      return { name, clientId, connected: true, time: 120, correct: 0, wrong: 0 };
    });

    if (!result.committed) {
      joinErrorEl.textContent = 'That lobby already has two players.';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join lobby';
      return;
    }

    localStorage.setItem('aw_last_lobby', JSON.stringify({ code, slot: 'p2' }));
    window.location.href = `game.html?code=${code}`;
  } catch (err) {
    console.error(err);
    joinErrorEl.textContent = 'Could not join. Check your Firebase setup / connection.';
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join lobby';
  }
});

usernameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
joinCodeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
