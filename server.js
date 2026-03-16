require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const lobbies = {};
const COLORS = ['#e8b4b8','#b8d4e8','#b8e8c4','#e8deb4','#d4b8e8','#e8c4b8','#b8e8e4','#e8e4b8'];

function genCode() {
  const w = ['GIALLO','ROSSO','NERO','VERDE','VIOLA','AZZURRO','BIANCO','ARANCIO'];
  return w[Math.floor(Math.random()*w.length)] + (Math.floor(Math.random()*9)+1);
}

function sanitizeLobby(lobby) {
  return {
    code: lobby.code, host: lobby.host, maxPlayers: lobby.maxPlayers,
    players: lobby.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
    started: lobby.started
  };
}

const SPECIAL_ROLES = [
  { name: 'detective', desc: 'Puoi fare una domanda diretta a un giocatore tramite chat privata senza che gli altri vedano la risposta.' },
  { name: 'medico legale', desc: 'Conosci la causa esatta della morte e il tipo di arma usata. Puoi rivelare o tenere per te questa informazione.' },
  { name: 'complice', desc: 'Sai chi è il colpevole ma non puoi rivelarlo. Devi depistare gli altri senza farti scoprire.' },
  { name: 'testimone falso', desc: 'Il tuo alibi è inventato. Se qualcuno ti smonta in chat, perdi credibilità ma rimani in gioco.' },
  { name: 'informatore', desc: 'Hai sentito una conversazione sospetta. Sai in quale stanza è avvenuto il crimine.' },
  { name: 'sospetto principale', desc: 'Tutti ti credono colpevole per via delle circostanze, ma potresti essere innocente.' },
  { name: 'testimone', desc: 'Hai visto qualcosa di importante ma non sai se è rilevante. Decidi tu quando rivelarlo.' }
];

async function generateStory(playerCount) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY mancante — ottienila gratis su console.groq.com');

  const roles = ['medico legale','complice','testimone falso','informatore','sospetto principale','testimone'];
  const assignedRoles = [];
  assignedRoles.push('detective');
  for (let i = 1; i < playerCount; i++) {
    assignedRoles.push(roles[(i-1) % roles.length]);
  }
  // shuffle
  for (let i = assignedRoles.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [assignedRoles[i],assignedRoles[j]] = [assignedRoles[j],assignedRoles[i]];
  }

  const culpritIdx = Math.floor(Math.random() * playerCount);

  const prompt = `Sei un game designer esperto di giochi tipo Cluedo. Crea una storia DIFFICILE e INTRICATA per ${playerCount} giocatori italiani.
La difficoltà deve essere MASSIMA: molti depistaggi, false piste, alibi che sembrano veri ma hanno piccole contraddizioni nascoste.

Rispondi SOLO con JSON valido, zero testo aggiuntivo, zero backtick.

{
  "titolo": "Titolo drammatico del caso",
  "scenario": "4-5 frasi che descrivono luogo, atmosfera e il crimine scoperto",
  "location_tipo": "villa|hotel|castello|nave|museo|treno|teatro",
  "victim": {
    "nome": "Nome Cognome",
    "professione": "Professione",
    "background": "2 frasi sul personaggio e perché qualcuno potrebbe volerlo morto"
  },
  "arma": {
    "nome": "Nome arma (es: veleno nel vino, pugnale d'avorio, corda di seta...)",
    "stanza_trovata": "Dove è stata trovata l'arma",
    "dettaglio": "Dettaglio forense sull'arma"
  },
  "stanze": [
    { "nome": "Nome stanza", "descrizione": "Breve descrizione atmosferica", "indizio_nascosto": "Un indizio sottile nascosto in questa stanza" }
  ],
  "colpevole_index": ${culpritIdx},
  "movente_reale": "Il vero movente del colpevole (segreto, rivelato solo alla fine)",
  "howdunit": "Come ha commesso il crimine esattamente (2-3 frasi dettagliate)",
  "twist": "Un colpo di scena finale che sorprende tutti",
  "characters": [
    {
      "name": "Nome Cognome",
      "professione": "Professione",
      "rapporto_vittima": "Rapporto con la vittima (amico, nemico, amante, rivale...)",
      "ruolo_speciale": "${assignedRoles[0]}",
      "location_iniziale": "Stanza dove si trovava",
      "alibi": "Alibi dettagliato (per il colpevole: alibi FALSO con piccola contraddizione nascosta)",
      "seen": "Cosa ha visto o sentito (può contenere depistaggio)",
      "proof": "Una prova o oggetto in suo possesso",
      "segreto_personale": "Un segreto personale NON legato al crimine ma imbarazzante (per rendere tutti sospettosi)",
      "istruzione_segreta": "Per innocenti: come comportarsi. Per colpevole inizia con SEI IL COLPEVOLE: e spiega come depistare"
    }
  ]
}

REGOLE CRITICHE:
- Esattamente ${playerCount} personaggi
- colpevole_index = ${culpritIdx} (0-based)
- Il colpevole ha istruzione_segreta che inizia con SEI IL COLPEVOLE:
- Almeno 6 stanze generate in base alla location
- Il colpevole ha un alibi con una PICCOLA contraddizione che i giocatori attenti possono trovare
- Il complice deve avere un alibi che copre parzialmente il colpevole
- Il testimone falso deve avere dettagli che non tornano
- Ogni stanza ha un indizio nascosto, almeno uno è un depistaggio
- Nomi italiani realistici, professioni coerenti con la location`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'Sei un game designer italiano esperto di gialli e misteri. Rispondi SOLO con JSON valido, nessun testo extra.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.9,
    max_tokens: 3000,
    response_format: { type: 'json_object' }
  });

  const text = completion.choices[0]?.message?.content || '';
  const story = JSON.parse(text);

  if (!story.characters || story.characters.length < 2) throw new Error('Storia non valida. Riprova.');
  story.colpevole_index = Math.min(culpritIdx, story.characters.length - 1);

  // Arricchisci i ruoli speciali con descrizioni
  story.characters.forEach((c, i) => {
    const roleData = SPECIAL_ROLES.find(r => r.name === c.ruolo_speciale) || SPECIAL_ROLES[6];
    c.ruolo_desc = roleData.desc;
    c.ruolo_speciale = roleData.name;
  });

  return story;
}

io.on('connection', (socket) => {
  console.log('+ Connesso:', socket.id);

  socket.on('create_lobby', ({ name, maxPlayers }, cb) => {
    let code; do { code = genCode(); } while (lobbies[code]);
    const player = { id: socket.id, name, color: COLORS[0] };
    lobbies[code] = {
      code, host: socket.id,
      maxPlayers: Math.min(10, Math.max(3, maxPlayers || 5)),
      players: [player], started: false, story: null, votes: {}, readyCount: 0
    };
    socket.join(code);
    socket.data.lobbyCode = code;
    socket.data.playerName = name;
    cb({ success: true, code, player });
    io.to(code).emit('lobby_update', sanitizeLobby(lobbies[code]));
  });

  socket.on('join_lobby', ({ name, code }, cb) => {
    const lobby = lobbies[code];
    if (!lobby) return cb({ success: false, error: 'Lobby non trovata.' });
    if (lobby.started) return cb({ success: false, error: 'Partita già iniziata.' });
    if (lobby.players.length >= lobby.maxPlayers) return cb({ success: false, error: 'Lobby piena!' });
    const player = { id: socket.id, name, color: COLORS[lobby.players.length % COLORS.length] };
    lobby.players.push(player);
    socket.join(code); socket.data.lobbyCode = code; socket.data.playerName = name;
    cb({ success: true, code, player });
    io.to(code).emit('lobby_update', sanitizeLobby(lobby));
    io.to(code).emit('chat_message', { type: 'system', text: `${name} è entrato nella lobby` });
  });

  socket.on('start_game', async (_, cb) => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return cb && cb({ success: false, error: 'Lobby non trovata' });
    if (lobby.host !== socket.id) return cb && cb({ success: false, error: "Solo l'host può avviare" });
    if (lobby.players.length < 2) return cb && cb({ success: false, error: 'Servono almeno 2 giocatori' });
    lobby.started = true;
    io.to(code).emit('game_loading');
    try {
      const story = await generateStory(lobby.players.length);
      lobby.story = story;

      lobby.players.forEach((player, i) => {
        const charIndex = i % story.characters.length;
        const character = story.characters[charIndex];
        const isCulprit = charIndex === story.colpevole_index;
        io.to(player.id).emit('game_start', {
          story: {
            titolo: story.titolo,
            scenario: story.scenario,
            location_tipo: story.location_tipo,
            victim: story.victim,
            arma: story.arma,
            stanze: story.stanze,
            characters: story.characters.map(c => ({
              name: c.name, professione: c.professione,
              rapporto_vittima: c.rapporto_vittima,
              ruolo_speciale: c.ruolo_speciale,
              location_iniziale: c.location_iniziale
            }))
          },
          myCharacter: character,
          isCulprit,
          myIndex: charIndex
        });
      });

      io.to(code).emit('chat_message', {
        type: 'system',
        text: `Caso aperto: "${story.titolo}" — ${story.location_tipo.toUpperCase()} · Vittima: ${story.victim.nome}`
      });
      cb && cb({ success: true });
    } catch (e) {
      console.error('Errore AI:', e.message);
      lobby.started = false;
      io.to(code).emit('game_error', { message: e.message });
      cb && cb({ success: false, error: e.message });
    }
  });

  // Chat pubblica
  socket.on('send_message', ({ text }) => {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const now = new Date();
    const time = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    io.to(code).emit('chat_message', {
      type: 'player', name: socket.data.playerName, text, time, senderId: socket.id
    });
  });

  // Chat privata
  socket.on('send_private', ({ toId, text }) => {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const lobby = lobbies[code];
    if (!lobby) return;
    const toPlayer = lobby.players.find(p => p.id === toId);
    if (!toPlayer) return;
    const now = new Date();
    const time = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    const msg = { type: 'private', from: socket.data.playerName, fromId: socket.id, to: toPlayer.name, toId, text, time };
    socket.emit('private_message', msg);
    io.to(toId).emit('private_message', msg);
  });

  socket.on('player_ready', () => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return;
    lobby.readyCount = (lobby.readyCount || 0) + 1;
    io.to(code).emit('ready_update', { readyCount: lobby.readyCount, total: lobby.players.length });
  });

  // Rivela indizio stanza
  socket.on('reveal_clue', ({ stanzaNome }) => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby || !lobby.story) return;
    const stanza = lobby.story.stanze.find(s => s.nome === stanzaNome);
    if (!stanza) return;
    const name = socket.data.playerName;
    io.to(code).emit('chat_message', {
      type: 'clue',
      text: `🔍 ${name} ha trovato un indizio nella ${stanzaNome}: "${stanza.indizio_nascosto}"`
    });
  });

  socket.on('cast_vote', ({ votedName }) => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby || !lobby.story) return;
    lobby.votes[socket.id] = votedName;
    const voteCount = Object.keys(lobby.votes).length;
    io.to(code).emit('vote_update', { voteCount, total: lobby.players.length });
    if (voteCount >= lobby.players.length) {
      const tally = {};
      Object.values(lobby.votes).forEach(n => { tally[n] = (tally[n] || 0) + 1; });
      const topVoted = Object.entries(tally).sort((a,b) => b[1]-a[1])[0][0];
      const culprit = lobby.story.characters[lobby.story.colpevole_index].name;
      io.to(code).emit('game_over', {
        correct: topVoted === culprit,
        culpritName: culprit,
        culprit: lobby.story.characters[lobby.story.colpevole_index],
        howdunit: lobby.story.howdunit,
        movente: lobby.story.movente_reale,
        twist: lobby.story.twist,
        arma: lobby.story.arma,
        tally
      });
      delete lobbies[code];
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return;
    const name = socket.data.playerName;
    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    if (lobby.players.length === 0) { delete lobbies[code]; return; }
    if (lobby.host === socket.id) { lobby.host = lobby.players[0].id; io.to(lobby.host).emit('you_are_host'); }
    io.to(code).emit('lobby_update', sanitizeLobby(lobby));
    io.to(code).emit('chat_message', { type: 'system', text: `${name} ha lasciato la partita` });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔍 Chi è il Colpevole? v2 — http://localhost:${PORT}`);
  console.log(`🤖 AI: llama-3.3-70b via Groq (GRATIS)`);
  if (!process.env.GROQ_API_KEY) console.warn('\n⚠️  GROQ_API_KEY mancante!\n');
});
