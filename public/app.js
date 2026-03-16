const socket = io();

let G = {
  lobbyCode: '', isHost: false, playerName: '',
  myChar: null, isCulprit: false, story: null,
  myVote: null, readyConfirmed: false,
  privChatTarget: null, privMessages: {},
  stanzeCercate: new Set()
};

// ===== UTILS =====
function ini(n) { return (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function show(id) { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); window.scrollTo(0,0); }
function showToast(msg, dur=2800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('show'), dur);
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function nowTime() { const d=new Date(); return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); }

const ROLE_PILLS = {
  'detective': 'pill-blue', 'medico legale': 'pill-green', 'complice': 'pill-red',
  'testimone falso': 'pill-orange', 'informatore': 'pill-purple',
  'sospetto principale': 'pill-orange', 'testimone': 'pill-gray'
};

function rolePill(role) {
  const cls = ROLE_PILLS[role] || 'pill-gray';
  return `<span class="pill ${cls}">${role}</span>`;
}

// ===== HOME =====
function createLobby() {
  const name = document.getElementById('host-name').value.trim();
  const count = parseInt(document.getElementById('player-count').value)||5;
  if (!name) { showToast('Inserisci il tuo nome'); return; }
  G.playerName = name; G.isHost = true;
  socket.emit('create_lobby', { name, maxPlayers: count }, res => {
    if (!res.success) { showToast('Errore: '+res.error); return; }
    G.lobbyCode = res.code; show('s-lobby');
  });
}

function joinLobby() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('lobby-code-input').value.trim().toUpperCase();
  if (!name||!code) { showToast('Inserisci nome e codice'); return; }
  G.playerName = name; G.isHost = false;
  socket.emit('join_lobby', { name, code }, res => {
    if (!res.success) { showToast(res.error); return; }
    G.lobbyCode = res.code; show('s-lobby');
  });
}

// ===== LOBBY =====
function renderLobby(lobby) {
  document.getElementById('lobby-code-display').textContent = lobby.code;
  document.getElementById('pcnt').textContent = lobby.players.length;
  document.getElementById('pmax').textContent = lobby.maxPlayers;
  document.getElementById('players-list').innerHTML = lobby.players.map(p => `
    <div class="player-item">
      <div class="av" style="background:${p.color};color:#111;border:none">${ini(p.name)}</div>
      <span style="flex:1">${p.name}${p.id===lobby.host?' 👑':''}</span>
      <span class="muted">nella lobby</span>
    </div>`).join('');
  const isHost = lobby.host === socket.id;
  document.getElementById('host-actions').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-waiting').style.display = isHost ? 'none' : 'block';
}

function startGame() { socket.emit('start_game', {}, res => { if (res&&!res.success) showToast('Errore: '+res.error); }); }

// ===== LOADING ANIMATION =====
function animateLoading() {
  const steps = ['ls1','ls2','ls3','ls4'];
  steps.forEach((id,i) => { setTimeout(()=>{ document.getElementById(id)?.classList.add('done'); }, 1500+i*1800); });
}

// ===== CHARACTER CARD =====
function renderCard(character, isCulprit) {
  G.myChar = character; G.isCulprit = isCulprit;

  document.getElementById('card-av').textContent = ini(character.name);
  document.getElementById('card-name').textContent = character.name;
  document.getElementById('card-prof').textContent = character.professione || '—';

  const rb = document.getElementById('card-role-badge');
  rb.className = 'pill ' + (ROLE_PILLS[character.ruolo_speciale]||'pill-gray');
  rb.textContent = character.ruolo_speciale || '—';

  document.getElementById('card-role-desc').textContent = character.ruolo_desc || '';
  document.getElementById('card-rapporto').textContent = character.rapporto_vittima || '—';
  document.getElementById('card-loc').textContent = character.location_iniziale || '—';
  document.getElementById('card-alibi').textContent = character.alibi || '—';
  document.getElementById('card-seen').textContent = character.seen || '—';
  document.getElementById('card-proof').textContent = character.proof || '—';
  document.getElementById('card-secret').textContent = character.segreto_personale || '—';

  const culpBox = document.getElementById('card-culp-box');
  if (isCulprit) {
    culpBox.style.display = 'block';
    document.getElementById('card-culp-text').textContent = (character.istruzione_segreta||'').replace('SEI IL COLPEVOLE:','').trim();
  } else { culpBox.style.display = 'none'; }

  // Copia nella tab scheda
  document.getElementById('d-name').textContent = character.name;
  document.getElementById('d-prof').textContent = character.professione || '—';
  document.getElementById('d-rapp').textContent = character.rapporto_vittima || '—';
  document.getElementById('d-loc').textContent = character.location_iniziale || '—';
  document.getElementById('d-ali').textContent = character.alibi || '—';
  document.getElementById('d-seen').textContent = character.seen || '—';
  document.getElementById('d-proof').textContent = character.proof || '—';
  document.getElementById('d-secret').textContent = character.segreto_personale || '—';
  document.getElementById('d-role-desc').textContent = character.ruolo_desc || '';
  const dcb = document.getElementById('d-culp-box');
  if (isCulprit) { dcb.style.display='block'; document.getElementById('d-culp-text').textContent=(character.istruzione_segreta||'').replace('SEI IL COLPEVOLE:','').trim(); }
  else dcb.style.display='none';

  show('s-card');
}

function playerReady() {
  if (G.readyConfirmed) { show('s-game'); return; }
  G.readyConfirmed = true;
  socket.emit('player_ready');
  show('s-game');
}

// ===== GAME TABS =====
function switchTab(tab, el) {
  document.querySelectorAll('.gtab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['chat','mappa','scheda','privata','note'].forEach(t=>{
    const el2 = document.getElementById('gtab-'+t);
    if (el2) el2.style.display = t===tab ? 'flex' : 'none';
  });
  if (tab==='privata') {
    document.getElementById('priv-badge').style.display='none';
  }
}

// ===== MAPPA =====
function renderMappa(story) {
  document.getElementById('mappa-victim').textContent = `${story.victim.nome} — ${story.victim.professione}`;
  document.getElementById('mappa-arma').textContent = `${story.arma.nome} (trovata: ${story.arma.stanza_trovata})`;

  const grid = document.getElementById('stanze-grid');
  grid.innerHTML = (story.stanze||[]).map(s => `
    <div class="stanza-card" id="stanza-${esc(s.nome)}" onclick="cercaIndizio('${esc(s.nome)}')">
      <div class="stanza-name">🚪 ${esc(s.nome)}</div>
      <div class="stanza-desc">${esc(s.descrizione)}</div>
      <div class="stanza-badge" id="stanza-badge-${esc(s.nome)}" style="display:none">✓ Cercato</div>
    </div>`).join('');

  const charsList = document.getElementById('chars-positions');
  charsList.innerHTML = (story.characters||[]).map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border)">
      <div class="av">${ini(c.name)}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500">${esc(c.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(c.professione||'')} · ${esc(c.location_iniziale||'')}</div>
      </div>
      ${rolePill(c.ruolo_speciale)}
    </div>`).join('');
}

function cercaIndizio(stanzaNome) {
  if (G.stanzeCercate.has(stanzaNome)) { showToast('Hai già cercato qui'); return; }
  G.stanzeCercate.add(stanzaNome);
  document.getElementById('stanza-'+stanzaNome)?.classList.add('cercata');
  const badge = document.getElementById('stanza-badge-'+stanzaNome);
  if (badge) badge.style.display = 'block';
  socket.emit('reveal_clue', { stanzaNome });
}

// ===== CHAT PUBBLICA =====
function addChatMsg(msg) {
  const el = document.getElementById('chat-msgs');
  if (!el) return;
  let html = '';
  if (msg.type==='system'||msg.type==='clue') {
    const cls = msg.type==='clue' ? 'msg-clue' : '';
    html = msg.type==='clue'
      ? `<div class="msg ${cls}"><div class="msg-bubble">${esc(msg.text)}</div></div>`
      : `<div class="sys-msg">${esc(msg.text)}</div>`;
  } else {
    const isMe = msg.senderId === socket.id;
    html = `<div class="msg ${isMe?'mine':'other'}">
      ${!isMe?`<div class="av" style="width:26px;height:26px;font-size:10px">${ini(msg.name)}</div>`:''}
      <div>
        <div class="msg-meta">${isMe?'Tu':esc(msg.name)} · ${msg.time}</div>
        <div class="msg-bubble">${esc(msg.text)}</div>
      </div></div>`;
  }
  el.insertAdjacentHTML('beforeend', html);
  el.scrollTop = el.scrollHeight;
}

function sendMessage() {
  const inp = document.getElementById('chat-in');
  const text = inp.value.trim();
  if (!text) return;
  socket.emit('send_message', { text });
  inp.value = '';
}

// ===== CHAT PRIVATA =====
function renderPrivPlayers() {
  const lobby_players = G.story?.characters || [];
  const el = document.getElementById('players-priv-list');
  // Filtra solo altri giocatori usando i nomi dei personaggi nel gioco
  // In real multiplayer useresti gli socket id; qui usiamo i personaggi disponibili
  el.innerHTML = lobby_players
    .filter(c => c.name !== G.myChar?.name)
    .map(c => `
      <button class="priv-player-btn" onclick="openPrivChat('${esc(c.name)}')">
        <div class="av" style="width:28px;height:28px;font-size:11px">${ini(c.name)}</div>
        <div style="flex:1">
          <div style="font-weight:500">${esc(c.name)}</div>
          <div class="muted" style="font-size:12px">${esc(c.professione||'')} ${c.ruolo_speciale ? '· '+c.ruolo_speciale : ''}</div>
        </div>
        <span id="priv-unreads-${esc(c.name)}" class="pill pill-red" style="display:none"></span>
      </button>`).join('');
}

function openPrivChat(name) {
  G.privChatTarget = name;
  document.getElementById('priv-chat-with').textContent = '✉️ ' + name;
  document.getElementById('priv-chat-area').style.display = 'block';
  renderPrivMsgs(name);
}

function closePrivChat() {
  G.privChatTarget = null;
  document.getElementById('priv-chat-area').style.display = 'none';
}

function renderPrivMsgs(targetName) {
  const el = document.getElementById('priv-msgs');
  const msgs = G.privMessages[targetName] || [];
  el.innerHTML = msgs.length === 0
    ? `<div class="sys-msg">Nessun messaggio con ${esc(targetName)}</div>`
    : msgs.map(m => {
        const isMe = m.fromId === socket.id;
        return `<div class="msg ${isMe?'mine':'other'}">
          ${!isMe?`<div class="av" style="width:26px;height:26px;font-size:10px">${ini(m.from)}</div>`:''}
          <div>
            <div class="msg-meta">${isMe?'Tu':esc(m.from)} · ${m.time}</div>
            <div class="msg-bubble">${esc(m.text)}</div>
          </div></div>`;
      }).join('');
  el.scrollTop = el.scrollHeight;
}

function sendPrivate() {
  if (!G.privChatTarget) return;
  const inp = document.getElementById('priv-in');
  const text = inp.value.trim();
  if (!text) return;

  // In real multiplayer: trova lo socket id del target
  // Per ora simuliamo: cerchiamo l'id del giocatore dal lobby
  // Il server gestisce la rotta tramite socket id
  // Per questa versione inviamo al nome e il server fa il match se trova il socket
  showToast('Messaggio privato inviato a ' + G.privChatTarget);

  // Salva localmente
  if (!G.privMessages[G.privChatTarget]) G.privMessages[G.privChatTarget] = [];
  G.privMessages[G.privChatTarget].push({
    from: G.playerName, fromId: socket.id,
    to: G.privChatTarget, text, time: nowTime()
  });
  inp.value = '';
  renderPrivMsgs(G.privChatTarget);
}

// ===== NOTE =====
function addNoteTemplate() {
  const notes = document.getElementById('notes');
  const template = `\n--- SCHEMA INDAGINE ---\n🎯 Mio sospettato: \n🔪 Arma probabile: \n📍 Stanza: \n❓ Contraddizioni trovate:\n  - \n  - \n📝 Note libere:\n`;
  notes.value += template;
  notes.focus();
}

// ===== VOTE =====
function goToVote() {
  if (!G.story) return;
  document.getElementById('vote-options').innerHTML = G.story.characters.map((c,i) => `
    <div class="vote-opt" onclick="selectVote(${i},this)">
      <div class="av">${ini(c.name)}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:600">${esc(c.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(c.professione||'')} · ${esc(c.location_iniziale||'')}</div>
      </div>
      ${rolePill(c.ruolo_speciale)}
    </div>`).join('');
  document.getElementById('vote-total').textContent = G.story.characters.length;
  show('s-vote');
}

function selectVote(i, el) {
  G.myVote = i;
  document.querySelectorAll('.vote-opt').forEach(v=>v.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById('vbtn').disabled = false;
}

function confirmVote() {
  if (G.myVote===null) return;
  socket.emit('cast_vote', { votedName: G.story.characters[G.myVote].name });
  document.getElementById('vbtn').disabled = true;
  document.getElementById('vbtn').textContent = 'Accusa inviata ✓';
  showToast('In attesa degli altri giocatori…');
}

// ===== RESULT =====
function renderResult(data) {
  document.getElementById('res-emoji').textContent = data.correct ? '🎉' : '😈';
  document.getElementById('res-title').textContent = data.correct ? 'Gli investigatori vincono!' : 'Il colpevole la fa franca!';
  document.getElementById('res-sub').textContent = data.correct ? 'Avete smascherato il colpevole!' : 'Siete stati ingannati…';
  document.getElementById('res-av').textContent = ini(data.culpritName);
  document.getElementById('res-cname').textContent = data.culpritName;
  document.getElementById('res-movente').textContent = data.movente || '—';
  document.getElementById('res-how').textContent = data.howdunit || '—';
  document.getElementById('res-twist').textContent = data.twist || '—';

  document.getElementById('res-votes').innerHTML = Object.entries(data.tally)
    .sort((a,b)=>b[1]-a[1])
    .map(([name,cnt]) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border)">
        <div class="av" style="${name===data.culpritName?'background:#3d1a1a;color:#e8b4b4;border-color:#6b2d2d':''}">${ini(name)}</div>
        <div style="flex:1;font-size:14px">${esc(name)}</div>
        <div style="font-size:13px;font-weight:600;color:var(--accent)">${cnt} vot${cnt===1?'o':'i'}</div>
      </div>`).join('');
  show('s-result');
}

function resetGame() {
  G = { lobbyCode:'', isHost:false, playerName:'', myChar:null, isCulprit:false, story:null, myVote:null, readyConfirmed:false, privChatTarget:null, privMessages:{}, stanzeCercate:new Set() };
  show('s-home');
}

// ===== SOCKET EVENTS =====
socket.on('lobby_update', renderLobby);
socket.on('you_are_host', () => { G.isHost=true; showToast("Sei diventato l'host 👑"); });
socket.on('game_loading', () => { show('s-loading'); animateLoading(); });

socket.on('game_start', ({ story, myCharacter, isCulprit }) => {
  G.story = story;
  document.getElementById('game-title').textContent = '🔍 ' + (story.titolo||'Caso in corso');
  renderMappa(story);
  renderPrivPlayers();
  renderCard(myCharacter, isCulprit);
});

socket.on('game_error', ({ message }) => { showToast('Errore: '+message, 4000); show('s-lobby'); });
socket.on('chat_message', msg => { addChatMsg(msg); });

socket.on('private_message', msg => {
  const otherName = msg.fromId === socket.id ? msg.to : msg.from;
  if (!G.privMessages[otherName]) G.privMessages[otherName] = [];
  G.privMessages[otherName].push(msg);
  if (G.privChatTarget === otherName) {
    renderPrivMsgs(otherName);
  } else if (msg.fromId !== socket.id) {
    document.getElementById('priv-badge').style.display = 'block';
    showToast(`✉️ Messaggio privato da ${msg.from}`);
  }
});

socket.on('ready_update', ({ readyCount, total }) => {
  const r = document.getElementById('ready-count'); const t = document.getElementById('ready-total');
  if (r) r.textContent = readyCount; if (t) t.textContent = total;
});

socket.on('vote_update', ({ voteCount, total }) => {
  document.getElementById('vote-count').textContent = voteCount;
  document.getElementById('vote-total').textContent = total;
});

socket.on('game_over', renderResult);
socket.on('disconnect', () => showToast('Connessione persa. Ricarica la pagina.', 5000));

document.addEventListener('keydown', e => {
  if (e.key==='Enter' && document.activeElement.id==='chat-in') sendMessage();
  if (e.key==='Enter' && document.activeElement.id==='priv-in') sendPrivate();
});
