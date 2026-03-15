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
const COLORS = ['#B5D4F4','#9FE1CB','#F5C4B3','#CECBF6','#FAC775','#F4C0D1','#97C459','#ED93B1'];

function genCode() {
  const words = ['GIALLO','ROSSO','NERO','VERDE','VIOLA','AZZURRO','BIANCO','ARANCIO'];
  return words[Math.floor(Math.random() * words.length)] + (Math.floor(Math.random() * 9) + 1);
}

function sanitizeLobby(lobby) {
  return {
    code: lobby.code, host: lobby.host,
    maxPlayers: lobby.maxPlayers,
    players: lobby.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
    started: lobby.started
  };
}

async function generateStory(playerCount) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY mancante — ottienila gratis su console.groq.com');
  }

  const prompt = `Crea una storia per un gioco "Chi e il colpevole?" con esattamente ${playerCount} personaggi italiani.
Rispondi SOLO con JSON valido, senza backtick, senza testo aggiuntivo.

{
  "scenario": "3-4 frasi che descrivono luogo e crimine",
  "victim": "Nome vittima",
  "location": "hotel",
  "culprit_index": 1,
  "howdunit": "Come ha commesso il crimine (2 frasi)",
  "characters": [
    {
      "name": "Nome Cognome",
      "role": "detective",
      "location": "Dove si trovava",
      "alibi": "Alibi dettagliato",
      "seen": "Cosa ha visto o sentito",
      "proof": "Una prova o indizio",
      "secret": "Un segreto utile alle indagini"
    }
  ]
}

REGOLE:
- Esattamente ${playerCount} personaggi
- culprit_index tra 0 e ${playerCount - 1}
- Il personaggio al culprit_index ha secret che INIZIA con: SEI IL COLPEVOLE:
- Almeno 1 detective e 1 testimone, il resto sospetti
- Nomi italiani`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'Sei un game designer italiano. Rispondi SOLO con JSON valido, zero testo aggiuntivo.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.8,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  const text = completion.choices[0]?.message?.content || '';
  const story = JSON.parse(text);

  if (!story.characters || story.characters.length < 2) {
    throw new Error('Storia non valida generata. Riprova.');
  }

  // Aggiusta se l'AI ha messo meno personaggi del previsto
  story.culprit_index = Math.min(story.culprit_index, story.characters.length - 1);
  return story;
}

io.on('connection', (socket) => {
  console.log('+ Connesso:', socket.id);

  socket.on('create_lobby', ({ name, maxPlayers }, cb) => {
    let code;
    do { code = genCode(); } while (lobbies[code]);
    const player = { id: socket.id, name, color: COLORS[0] };
    lobbies[code] = {
      code, host: socket.id,
      maxPlayers: Math.min(10, Math.max(4, maxPlayers || 5)),
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
    if (!lobby) return cb({ success: false, error: 'Lobby non trovata. Controlla il codice.' });
    if (lobby.started) return cb({ success: false, error: 'Partita gia iniziata.' });
    if (lobby.players.length >= lobby.maxPlayers) return cb({ success: false, error: 'Lobby piena!' });
    const player = { id: socket.id, name, color: COLORS[lobby.players.length % COLORS.length] };
    lobby.players.push(player);
    socket.join(code);
    socket.data.lobbyCode = code;
    socket.data.playerName = name;
    cb({ success: true, code, player });
    io.to(code).emit('lobby_update', sanitizeLobby(lobby));
    io.to(code).emit('chat_message', { type: 'system', text: `${name} e entrato nella lobby` });
  });

  socket.on('start_game', async (_, cb) => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return cb && cb({ success: false, error: 'Lobby non trovata' });
    if (lobby.host !== socket.id) return cb && cb({ success: false, error: "Solo l'host puo avviare" });
    if (lobby.players.length < 2) return cb && cb({ success: false, error: 'Servono almeno 2 giocatori' });

    lobby.started = true;
    io.to(code).emit('game_loading', { message: 'Groq AI sta costruendo il caso...' });

    try {
      const story = await generateStory(lobby.players.length);
      lobby.story = story;

      lobby.players.forEach((player, i) => {
        const charIndex = i % story.characters.length;
        const character = story.characters[charIndex];
        const isCulprit = charIndex === story.culprit_index;
        io.to(player.id).emit('game_start', {
          story: {
            scenario: story.scenario, victim: story.victim, location: story.location,
            characters: story.characters.map(c => ({ name: c.name, role: c.role, location: c.location }))
          },
          myCharacter: character, isCulprit
        });
      });

      io.to(code).emit('chat_message', {
        type: 'system',
        text: `Partita iniziata! ${story.location.toUpperCase()} - Vittima: ${story.victim}`
      });
      cb && cb({ success: true });
    } catch (e) {
      console.error('Errore AI:', e.message);
      lobby.started = false;
      io.to(code).emit('game_error', { message: e.message });
      cb && cb({ success: false, error: e.message });
    }
  });

  socket.on('send_message', ({ text }) => {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const now = new Date();
    const time = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    io.to(code).emit('chat_message', { type: 'player', name: socket.data.playerName, text, time, senderId: socket.id });
  });

  socket.on('player_ready', () => {
    const code = socket.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return;
    lobby.readyCount = (lobby.readyCount || 0) + 1;
    io.to(code).emit('ready_update', { readyCount: lobby.readyCount, total: lobby.players.length });
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
      const topVoted = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      const culprit = lobby.story.characters[lobby.story.culprit_index].name;
      io.to(code).emit('game_over', {
        correct: topVoted === culprit, culpritName: culprit,
        howdunit: lobby.story.howdunit, tally, players: lobby.players
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
    if (lobby.host === socket.id) {
      lobby.host = lobby.players[0].id;
      io.to(lobby.host).emit('you_are_host');
    }
    io.to(code).emit('lobby_update', sanitizeLobby(lobby));
    io.to(code).emit('chat_message', { type: 'system', text: `${name} ha lasciato la partita` });
    console.log('- Disconnesso:', socket.id, name);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔍 Chi e il Colpevole? — http://localhost:${PORT}`);
  console.log(`🤖 AI: llama-3.3-70b-versatile via Groq (GRATIS)`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('\n⚠️  GROQ_API_KEY mancante! Ottienila gratis su https://console.groq.com\n');
  }
});
