'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const QuestionService = require('./questionService');
const Store = require('./store');
const { GameSession } = require('./gameManager');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Optional Redis adapter for horizontal scale-out (200+ users / multiple instances) ---
// Enable by setting REDIS_URL (e.g. Azure Cache for Redis connection string).
(async () => {
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { Redis } = require('ioredis');
      const pub = new Redis(process.env.REDIS_URL);
      const sub = pub.duplicate();
      io.adapter(createAdapter(pub, sub));
      console.log('[trivia] Redis adapter enabled — ready for multi-instance scale-out.');
    } catch (e) {
      console.warn('[trivia] REDIS_URL set but adapter not available:', e.message);
    }
  }
})();

const questions = new QuestionService();
const store = new Store();

/** pin -> GameSession */
const games = new Map();
const makePin = () => {
  let pin;
  do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (games.has(pin));
  return pin;
};

// ---------- Optional passcode gate ----------
// Set TRIVIA_PASSCODE to require a shared code before anyone can access the app.
// Leave it unset for fully open access. Zero external dependencies.
const crypto = require('crypto');
const PASSCODE = process.env.TRIVIA_PASSCODE || '';
const AUTH_TOKEN = PASSCODE ? crypto.createHash('sha256').update('trivia:' + PASSCODE).digest('hex').slice(0, 32) : '';
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
const isAuthed = (req) => !PASSCODE || parseCookies(req.headers.cookie).trivia_auth === AUTH_TOKEN;

if (PASSCODE) {
  app.use(express.urlencoded({ extended: false }));
  const loginPage = (err = '') => `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>AI Trivia — Enter code</title>
  <style>body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(180deg,#DCE8F8,#EAF1FB);min-height:100vh;display:flex;align-items:center;justify-content:center;border-top:6px solid #005BC8}
  .card{background:#fff;border:1px solid #D5E0F0;border-radius:16px;padding:28px;width:320px;box-shadow:0 8px 26px rgba(10,27,61,.12);text-align:center}
  h1{color:#0A1B3D;font-size:22px;margin:0 0 4px}p{color:#5C6B8A;font-size:14px;margin:0 0 16px}
  input{width:100%;padding:14px;border:1.5px solid #D5E0F0;border-radius:12px;font-size:18px;text-align:center;letter-spacing:3px;box-sizing:border-box}
  button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;background:linear-gradient(90deg,#005BC8,#0A84FF)}
  .err{color:#CC2E28;font-size:13px;min-height:18px;margin-top:8px}</style></head>
  <body><form class="card" method="POST" action="/login"><h1>🧠 AI Trivia</h1><p>Enter the access code to continue</p>
  <input name="code" type="password" autofocus placeholder="Access code"/><button>Enter</button><div class="err">${err}</div></form></body></html>`;

  app.get('/login', (_req, res) => res.type('html').send(loginPage()));
  app.post('/login', (req, res) => {
    if ((req.body.code || '') === PASSCODE) {
      res.setHeader('Set-Cookie', `trivia_auth=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
      return res.redirect('/');
    }
    res.status(401).type('html').send(loginPage('Incorrect code — try again.'));
  });
  // gate everything except the login route and health check
  app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/health') return next();
    if (isAuthed(req)) return next();
    res.redirect('/login');
  });
  // gate socket connections too
  io.use((socket, next) => isAuthed(socket.request) ? next() : next(new Error('unauthorized')));
  console.log('[trivia] Passcode gate ENABLED (TRIVIA_PASSCODE is set).');
} else {
  console.log('[trivia] Open access (no TRIVIA_PASSCODE set).');
}

// ---------- Static + REST ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, games: games.size, bank: questions.meta }));
app.get('/api/meta', (_req, res) => res.json({
  bank: questions.meta,
  topics: questions.topics(),
  sessionsPlayed: store.getSessionCounter(),
  previous: store.getPreviousLeaderboard(),
  history: store.getHistory().slice(0, 10),
}));

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  let joinedPin = null;
  let isHost = false;

  // Presenter creates a session
  socket.on('host:create', ({ title, mode, count, topic } = {}, cb) => {
    const sessionNumber = store.nextSessionNumber();
    // presenter-chosen number of questions (default 20, clamped to a sane range)
    let n = parseInt(count, 10);
    if (!Number.isFinite(n)) n = 20;
    n = Math.max(5, Math.min(50, n));
    const chosenTopic = (topic && QuestionService.TOPICS[topic]) ? topic : 'all';
    const picked = questions.selectForSession(sessionNumber, n, store.getUsedIds(), chosenTopic);
    const pin = makePin();
    const game = new GameSession({ pin, hostId: socket.id, title, sessionNumber, questions: picked, mode });
    games.set(pin, game);
    joinedPin = pin; isHost = true;
    socket.join(pin);

    // relay session events to the room
    wireGame(game);

    cb && cb({
      ok: true, pin, sessionNumber, mode: game.mode, title: game.title,
      totalQuestions: picked.length,
      topic: chosenTopic, topicLabel: QuestionService.TOPICS[chosenTopic].label,
      previous: store.getPreviousLeaderboard(),
    });
    io.to(pin).emit('players', game.playerList());
  });

  // Player joins with a PIN
  socket.on('player:join', ({ pin, name } = {}, cb) => {
    const game = games.get(String(pin));
    if (!game) return cb && cb({ ok: false, reason: 'no_game' });
    if (game.state === 'finished') return cb && cb({ ok: false, reason: 'finished' });
    joinedPin = String(pin);
    socket.join(joinedPin);
    const p = game.addPlayer(socket.id, name);
    cb && cb({
      ok: true, pin: joinedPin, you: { id: p.id, name: p.name },
      title: game.title, sessionNumber: game.sessionNumber, state: game.state,
      previous: store.getPreviousLeaderboard(),
    });
  });

  socket.on('host:start', (_d, cb) => {
    const game = games.get(joinedPin);
    if (!game || socket.id !== game.hostId) return cb && cb({ ok: false });
    game.start();
    cb && cb({ ok: true });
  });

  socket.on('host:next', () => {
    const game = games.get(joinedPin);
    if (game && socket.id === game.hostId) {
      if (game.state === 'question') game.reveal();
      else game.nextQuestion();
    }
  });

  socket.on('host:reveal', () => {
    const game = games.get(joinedPin);
    if (game && socket.id === game.hostId && game.state === 'question') game.reveal();
  });

  socket.on('player:answer', ({ choice } = {}, cb) => {
    const game = games.get(joinedPin);
    if (!game) return cb && cb({ ok: false });
    const r = game.submitAnswer(socket.id, choice);
    cb && cb(r);
  });

  socket.on('disconnect', () => {
    const game = games.get(joinedPin);
    if (!game) return;
    if (isHost && socket.id === game.hostId) {
      // host left — end the game gracefully after a short grace period
      io.to(joinedPin).emit('host_left');
    } else {
      game.removePlayer(socket.id);
    }
  });

  // Wire a game's emitter to Socket.IO room broadcasts (idempotent per game)
  function wireGame(game) {
    if (game._wired) return; game._wired = true;
    const pin = game.pin;
    game.on('players', (list) => io.to(pin).emit('players', list));
    game.on('state', (s) => io.to(pin).emit('state', s));
    game.on('question', (q) => io.to(pin).emit('question', q));
    game.on('leaderboard', (l) => io.to(pin).emit('leaderboard', l));
    game.on('reveal', (r) => io.to(pin).emit('reveal', r));
    game.on('finished', (f) => {
      io.to(pin).emit('finished', f);
      store.commitSession(f.summary);       // persist leaderboard + used IDs
      setTimeout(() => games.delete(pin), 60000); // cleanup
    });
  }
});

server.listen(PORT, () => {
  console.log(`[trivia] AI Trivia server on http://localhost:${PORT}`);
  console.log(`[trivia] Presenter: http://localhost:${PORT}/presenter.html`);
  console.log(`[trivia] Players:   http://localhost:${PORT}/  (join screen)`);
  console.log(`[trivia] Bank:`, questions.meta.total, 'questions;', 'sessions played:', store.getSessionCounter());
});

module.exports = { app, server, io };
