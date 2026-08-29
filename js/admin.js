const ADMIN_USERNAME = 'Dimension21';
const ADMIN_PASSWORD = 'Test';

const loginCard = document.getElementById('login-card');
const enterCard = document.getElementById('enter-card');
const userEl = document.getElementById('admin-user');
const passEl = document.getElementById('admin-pass');
const loginErrorEl = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');
const codeEl = document.getElementById('admin-code');
const enterErrorEl = document.getElementById('enter-error');
const enterBtn = document.getElementById('enter-btn');
const logoutBtn = document.getElementById('logout-btn');

function showSignedIn() {
  loginCard.style.display = 'none';
  enterCard.style.display = 'block';
}

if (localStorage.getItem('aw_is_admin') === '1') {
  showSignedIn();
}

loginBtn.addEventListener('click', () => {
  const u = userEl.value.trim();
  const p = passEl.value;
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    localStorage.setItem('aw_is_admin', '1');
    loginErrorEl.textContent = '';
    showSignedIn();
  } else {
    loginErrorEl.textContent = 'Incorrect username or password.';
  }
});

passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });

codeEl.addEventListener('input', () => {
  codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6);
});

enterBtn.addEventListener('click', () => {
  const code = codeEl.value.trim();
  if (code.length !== 6) {
    enterErrorEl.textContent = 'Enter the 6-digit lobby code.';
    return;
  }
  window.location.href = `game.html?code=${code}`;
});
codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterBtn.click(); });

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('aw_is_admin');
  loginCard.style.display = 'block';
  enterCard.style.display = 'none';
  userEl.value = '';
  passEl.value = '';
});
