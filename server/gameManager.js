'use strict';
const { EventEmitter } = require('events');

const QUESTION_TIME_MS = 15000; // 15 seconds per question
const REVEAL_TIME_MS = 5000;    // time to show correct answer + standings
const MAX_POINTS = 1000;
const MIN_POINTS = 500;         // minimum points for a correct answer at the buzzer

/**
 * One live game session. Emits events the server relays over Socket.IO:
 *   'players'   -> participant list changed (join/leave)
 *   'question'  -> a new question is live (payload has NO correct answer)
 *   'reveal'    -> question ended: correct index, per-option counts, leaderboard
 *   'leaderboard' -> incremental leaderboard update (as answers arrive)
 *   'state'     -> lobby/running/reveal/finished changes
 *   'finished'  -> game over, final leaderboard + summary
 */
class GameSession extends EventEmitter {
  constructor({ pin, hostId, title, sessionNumber, questions, mode }) {
    super();
    this.pin = pin;
    this.hostId = hostId;
    this.title = title || `AI Trivia — Session ${sessionNumber}`;
    this.sessionNumber = sessionNumber;
    this.questions = questions;          // array of {id,q,options,answer,explanation,category,difficulty}
    this.mode = mode === 'auto' ? 'auto' : 'host'; // 'host' = manual advance, 'auto' = timed auto-run
    this.players = new Map();            // socketId -> {id,name,score,answers,streak}
    this.state = 'lobby';                // lobby | question | reveal | finished
    this.currentIndex = -1;
    this.currentQuestion = null;
    this.questionStart = 0;
    this.answersThisRound = new Map();   // playerId -> {choice, ms}
    this._timer = null;
    this._deadline = 0;
  }

  addPlayer(socketId, name) {
    const clean = String(name || '').trim().slice(0, 24) || `Player-${this.players.size + 1}`;
    this.players.set(socketId, { id: socketId, name: clean, score: 0, answers: [], streak: 0 });
    this.emit('players', this.playerList());
    return this.players.get(socketId);
  }

  removePlayer(socketId) {
    if (this.players.delete(socketId)) this.emit('players', this.playerList());
  }

  playerList() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score }));
  }

  leaderboard() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, streak: p.streak }));
  }

  start() {
    if (this.state !== 'lobby') return;
    this.nextQuestion();
  }

  nextQuestion() {
    this._clearTimer();
    this.currentIndex += 1;
    if (this.currentIndex >= this.questions.length) return this.finish();

    const q = this.questions[this.currentIndex];
    this.currentQuestion = q;
    this.answersThisRound = new Map();
    this.state = 'question';
    this.questionStart = Date.now();
    this._deadline = this.questionStart + QUESTION_TIME_MS;

    // payload sent to everyone — correct answer intentionally omitted
    this.emit('state', { state: this.state });
    this.emit('question', {
      index: this.currentIndex,
      total: this.questions.length,
      id: q.id,
      category: q.category,
      difficulty: q.difficulty,
      question: q.q,
      options: q.options,
      timeMs: QUESTION_TIME_MS,
      deadline: this._deadline,
      sessionNumber: this.sessionNumber,
    });

    if (this.mode === 'auto') {
      this._timer = setTimeout(() => this.reveal(), QUESTION_TIME_MS);
    }
  }

  submitAnswer(playerId, choice) {
    if (this.state !== 'question') return { ok: false, reason: 'not_accepting' };
    const p = this.players.get(playerId);
    if (!p) return { ok: false, reason: 'not_joined' };
    if (this.answersThisRound.has(playerId)) return { ok: false, reason: 'already_answered' };
    const now = Date.now();
    if (now > this._deadline) return { ok: false, reason: 'too_late' };
    const ms = now - this.questionStart;
    this.answersThisRound.set(playerId, { choice: Number(choice), ms });

    // live leaderboard tick: how many have answered (not who is right)
    this.emit('leaderboard', { answered: this.answersThisRound.size, players: this.players.size, live: this.leaderboard() });

    // in host mode, auto-reveal once everyone has answered
    if (this.mode === 'auto' && this.answersThisRound.size === this.players.size && this.players.size > 0) {
      this._clearTimer();
      this._timer = setTimeout(() => this.reveal(), 400);
    }
    return { ok: true, ms };
  }

  _score(ms) {
    const frac = Math.max(0, Math.min(1, ms / QUESTION_TIME_MS));
    return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * frac);
  }

  reveal() {
    if (this.state !== 'question') return;
    this._clearTimer();
    const q = this.currentQuestion;
    const counts = [0, 0, 0, 0];

    for (const [pid, ans] of this.answersThisRound) {
      if (ans.choice >= 0 && ans.choice < 4) counts[ans.choice]++;
      const p = this.players.get(pid);
      if (!p) continue;
      const correct = ans.choice === q.answer;
      const gained = correct ? this._score(ans.ms) : 0;
      if (correct) { p.streak += 1; if (p.streak >= 3) { /* streak bonus */ } }
      else p.streak = 0;
      const streakBonus = correct && p.streak >= 3 ? 100 : 0;
      p.score += gained + streakBonus;
      p.answers.push({ id: q.id, choice: ans.choice, correct, ms: ans.ms, gained: gained + streakBonus });
    }

    this.state = 'reveal';
    this.emit('state', { state: this.state });
    this.emit('reveal', {
      index: this.currentIndex,
      correctIndex: q.answer,
      explanation: q.explanation,
      counts,
      answered: this.answersThisRound.size,
      leaderboard: this.leaderboard(),
      isLast: this.currentIndex >= this.questions.length - 1,
    });

    if (this.mode === 'auto') {
      this._timer = setTimeout(() => this.nextQuestion(), REVEAL_TIME_MS);
    }
  }

  finish() {
    this._clearTimer();
    this.state = 'finished';
    const leaderboard = this.leaderboard();
    this.emit('state', { state: this.state });
    this.emit('finished', {
      leaderboard,
      summary: {
        title: this.title,
        sessionNumber: this.sessionNumber,
        playerCount: this.players.size,
        questionIds: this.questions.map(q => q.id),
        leaderboard,
      },
    });
  }

  timeLeftMs() { return Math.max(0, this._deadline - Date.now()); }
  _clearTimer() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } }
}

module.exports = { GameSession, QUESTION_TIME_MS };
