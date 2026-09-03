els.codeEyebrow.textContent = CODE ? `#${CODE}` : '';

if (!CODE || CODE.length !== 6) {
  document.querySelector('.masthead .eyebrow').textContent = 'invalid code';
  els.mastheadTitle.textContent = 'Lobby not found';
  const p = document.createElement('p');
  p.className = 'hint';
  p.innerHTML = 'That link is missing a valid 6-digit code. <a href="index.html">Return home</a>.';
  document.querySelector('.masthead').appendChild(p);
  throw new Error('no code');
}

window.addEventListener('fb-ready', init, { once: true });
if (window.__fb) init();

