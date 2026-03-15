// ===== SOCKET =====
const socket = io();

// ===== STATE =====
let G = {
  lobbyCode: '',
  isHost: false,
  myId: null,
  playerName: '',
  myCharacter: null,
  isCulprit: false,
  story: null,
  myVote: null,
  readyConfirmed: false
};

// ===== UTILS =====
function ini(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showToast(msg, duration = 2800) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function badgeClass(role, isCulprit) {
  if (isCulprit) return 'badge badge-colpevole';
  switch (role) {
    case 'detective': return 'badge badge-detective';
    case 'testimone':  return 'badge badge-testimone';
    default:           return 'badge badge-sospetto';
  }
}

function roleName(role, isCulprit) {
  if (isCulprit) return 'colpevole segreto';
  return role;
}

function nowTime() {
  const d = new Date();
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ===== SCREENS =====

function createLobby() {
  const name = document.getElementById('host-name').value.trim();
  const count = parseInt(document.getElementById('player-count').value) || 5;
  if (!name) { showToast('Inserisci il tuo nome'); return; }
  G.playerName = name;
  G.isHost = true;

  socket.emit('create_lobby', { name, maxPlayers: count }, (res) => {
    if (!res.success) { showToast('Errore: ' + res.error); return; }
    G.lobbyCode = res.code;
    G.myId = res.player.id;
    show('s-lobby');
  });
}

function joinLobby() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('lobby-code-input').value.trim().toUpperCase();
  if (!name || !code) { showToast('Inserisci nome e codice'); return; }
  G.playerName = name;
  G.isHost = false;

  socket.emit('join_lobby', { name, code }, (res) => {
    if (!res.success) { showToast(res.error); return; }
    G.lobbyCode = res.code;
    G.myId = res.player.id;
    show('s-lobby');
  });
}

function renderLobby(lobby) {
  document.getElementById('lobby-code-display').textContent = lobby.code;
  document.getElementById('player-count-now').textContent = lobby.players.length;
  document.getElementById('player-count-max').textContent = lobby.maxPlayers;

  const list = document.getElementById('players-list');
  list.innerHTML = lobby.players.map(p => `
    <div class="player-item">
      <div class="avatar" style="background:${p.color};color:#333">${ini(p.name)}</div>
      <span style="flex:1">${p.name}${p.id === lobby.host ? ' 👑' : ''}</span>
      <span class="hint">nella lobby</span>
    </div>
  `).join('');

  const isHost = lobby.host === socket.id;
  document.getElementById('host-actions').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-waiting').style.display = isHost ? 'none' : 'block';
}

function startGame() {
  socket.emit('start_game', {}, (res) => {
    if (res && !res.success) showToast('Errore: ' + res.error);
  });
}

// ===== CARD =====

function renderCharacterCard(character, isCulprit) {
  G.myCharacter = character;
  G.isCulprit = isCulprit;

  document.getElementById('card-avatar').textContent = ini(character.name);
  document.getElementById('card-name').textContent = character.name;

  const badge = document.getElementById('card-role-badge');
  badge.className = badgeClass(character.role, isCulprit);
  badge.textContent = roleName(character.role, isCulprit);

  document.getElementById('card-location').textContent = character.location;
  document.getElementById('card-alibi').textContent = character.alibi;
  document.getElementById('card-seen').textContent = character.seen;
  document.getElementById('card-proof').textContent = character.proof;

  const secretBox = document.getElementById('card-secret-box');
  secretBox.className = isCulprit ? 'secret-box-culp' : 'secret-box-inno';
  document.getElementById('card-secret-label').textContent = isCulprit ? '🔴 Sei il colpevole' : '🟢 Sei innocente';
  document.getElementById('card-secret-text').textContent = isCulprit
    ? character.secret.replace('SEI IL COLPEVOLE:', '').trim()
    : character.secret;

  // Popola anche la tab Scheda nella fase di gioco
  document.getElementById('d-name').textContent = character.name;
  document.getElementById('d-loc').textContent = character.location;
  document.getElementById('d-ali').textContent = character.alibi;
  document.getElementById('d-seen').textContent = character.seen;
  document.getElementById('d-proof').textContent = character.proof;

  const dsBox = document.getElementById('d-secret-box');
  dsBox.className = isCulprit ? 'secret-box-culp' : 'secret-box-inno';
  document.getElementById('d-secret-label').textContent = isCulprit ? '🔴 Sei il colpevole' : '🟢 Sei innocente';
  document.getElementById('d-secret-text').textContent = isCulprit
    ? character.secret.replace('SEI IL COLPEVOLE:', '').trim()
    : character.secret;

  show('s-card');
}

function renderCasoTab(story) {
  G.story = story;
  document.getElementById('caso-scenario').textContent = story.scenario;
  document.getElementById('caso-victim').textContent = story.victim;
  document.getElementById('caso-players').innerHTML = story.characters.map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border)">
      <div class="avatar">${ini(c.name)}</div>
      <div style="flex:1;font-size:14px">${c.name}</div>
      <span class="${badgeClass(c.role, false)}" style="font-size:11px">${c.role}</span>
    </div>
  `).join('');
}

function playerReady() {
  if (G.readyConfirmed) return;
  G.readyConfirmed = true;
  socket.emit('player_ready');
  show('s-game');
  document.getElementById('chat-msgs').innerHTML = '';
}

// ===== GAME TABS =====

function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['chat', 'scheda', 'caso', 'note'].forEach(t => {
    document.getElementById('gtab-' + t).style.display = t === tab ? 'block' : 'none';
  });
}

// ===== CHAT =====

function addChatMessage(msg) {
  const el = document.getElementById('chat-msgs');
  let html = '';

  if (msg.type === 'system') {
    html = `<div class="sys-msg">${msg.text}</div>`;
  } else {
    const isMe = msg.senderId === socket.id;
    html = `
      <div class="msg ${isMe ? 'mine' : 'other'}">
        ${!isMe ? `<div class="avatar" style="width:28px;height:28px;font-size:11px">${ini(msg.name)}</div>` : ''}
        <div>
          <div class="msg-meta">${isMe ? 'Tu' : msg.name} · ${msg.time}</div>
          <div class="msg-bubble">${escapeHtml(msg.text)}</div>
        </div>
      </div>`;
  }

  el.insertAdjacentHTML('beforeend', html);
  el.scrollTop = el.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send_message', { text });
  input.value = '';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== VOTE =====

function goToVote() {
  if (!G.story) return;
  const chars = G.story.characters;
  document.getElementById('vote-options').innerHTML = chars.map((c, i) => `
    <div class="vote-option" onclick="selectVote(${i}, this)">
      <div class="avatar">${ini(c.name)}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:600">${c.name}</div>
        <div style="font-size:12px;color:var(--text-muted)">${c.location}</div>
      </div>
    </div>
  `).join('');
  document.getElementById('vote-total').textContent = G.story.characters.length;
  show('s-vote');
}

function selectVote(index, el) {
  G.myVote = index;
  document.querySelectorAll('.vote-option').forEach(v => v.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('vote-confirm-btn').disabled = false;
}

function confirmVote() {
  if (G.myVote === null) return;
  const votedName = G.story.characters[G.myVote].name;
  socket.emit('cast_vote', { votedName });
  document.getElementById('vote-confirm-btn').disabled = true;
  document.getElementById('vote-confirm-btn').textContent = 'Voto inviato ✓';
  showToast('Voto inviato! In attesa degli altri…');
}

// ===== RESULT =====

function renderResult(data) {
  document.getElementById('result-emoji').textContent = data.correct ? '🎉' : '😈';
  document.getElementById('result-title').textContent = data.correct ? 'Gli investigatori vincono!' : 'Il colpevole vince!';
  document.getElementById('result-subtitle').textContent = data.correct
    ? 'Avete smascherato il colpevole!'
    : 'Vi siete fatti ingannare…';
  document.getElementById('result-avatar').textContent = ini(data.culpritName);
  document.getElementById('result-culprit').textContent = data.culpritName;
  document.getElementById('result-howdunit').textContent = data.howdunit;

  const sorted = Object.entries(data.tally).sort((a, b) => b[1] - a[1]);
  document.getElementById('result-votes').innerHTML = sorted.map(([name, count]) => `
    <div class="result-vote-row">
      <div class="avatar" style="${name === data.culpritName ? 'background:#FCEBEB;color:#A32D2D' : ''}">${ini(name)}</div>
      <div style="flex:1;font-size:14px">${name}</div>
      <div style="font-size:13px;font-weight:600">${count} vot${count === 1 ? 'o' : 'i'}</div>
    </div>
  `).join('');

  show('s-result');
}

function resetGame() {
  G = { lobbyCode: '', isHost: false, myId: null, playerName: '', myCharacter: null, isCulprit: false, story: null, myVote: null, readyConfirmed: false };
  show('s-home');
}

// ===== SOCKET EVENTS =====

socket.on('connect', () => {
  G.myId = socket.id;
});

socket.on('lobby_update', (lobby) => {
  renderLobby(lobby);
});

socket.on('you_are_host', () => {
  G.isHost = true;
  showToast("Sei diventato l'host 👑");
});

socket.on('game_loading', ({ message }) => {
  show('s-loading');
  const msgs = [
    'Costruendo il crimine…',
    'Inventando gli alibi…',
    'Nascondendo le prove…',
    'Assegnando il colpevole…',
    'Quasi pronto…'
  ];
  let mi = 0;
  document.getElementById('loading-msg').textContent = message;
  window._loadInterval = setInterval(() => {
    document.getElementById('loading-msg').textContent = msgs[mi++ % msgs.length];
  }, 1800);
});

socket.on('game_start', ({ story, myCharacter, isCulprit }) => {
  clearInterval(window._loadInterval);
  renderCasoTab(story);
  renderCharacterCard(myCharacter, isCulprit);
});

socket.on('game_error', ({ message }) => {
  clearInterval(window._loadInterval);
  showToast('Errore: ' + message, 4000);
  show('s-lobby');
});

socket.on('chat_message', (msg) => {
  addChatMessage(msg);
});

socket.on('ready_update', ({ readyCount, total }) => {
  const el = document.getElementById('ready-count');
  const tel = document.getElementById('ready-total');
  if (el) el.textContent = readyCount;
  if (tel) tel.textContent = total;
});

socket.on('vote_update', ({ voteCount, total }) => {
  document.getElementById('vote-count').textContent = voteCount;
  document.getElementById('vote-total').textContent = total;
});

socket.on('game_over', (data) => {
  renderResult(data);
});

socket.on('disconnect', () => {
  showToast('Connessione persa. Ricarica la pagina.', 5000);
});

// Enter to send chat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement.id === 'chat-input') {
    sendMessage();
  }
});
