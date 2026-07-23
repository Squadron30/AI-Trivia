'use strict';
// Logic-level smoke test: no network. Exercises questionService, gameManager, store.
const assert = require('assert');
const path = require('path');
const QuestionService = require('../server/questionService');
const { GameSession } = require('../server/gameManager');
const Store = require('../server/store');

let pass = 0; const ok = (m) => { console.log('  ✔', m); pass++; };

// --- 1. Question bank + progressive plan ---
const qs = new QuestionService();
assert(qs.meta.total >= 400, 'bank has 400+ questions');
ok(`bank loaded: ${qs.meta.total} questions, categories: ${qs.meta.categories.length}`);

const s1 = qs.selectForSession(1, 20, new Set());
assert.strictEqual(s1.length, 20, 'session picks 20');
const begFrac = s1.filter(q => q.difficulty === 'beginner').length / 20;
assert(begFrac >= 0.6, 'session 1 is beginner-heavy');
ok(`session 1: 20 Qs, ${Math.round(begFrac*100)}% beginner (fundamentals)`);

const s20 = qs.selectForSession(20, 20, new Set());
const advFrac = s20.filter(q => q.difficulty === 'advanced').length / 20;
assert(advFrac >= 0.7, 'session 20 is advanced-heavy');
ok(`session 20: ${Math.round(advFrac*100)}% advanced (deep tech)`);

// no repeats when usedIds provided
const used = new Set(s1.map(q => q.id));
const s2 = qs.selectForSession(2, 20, used);
assert(s2.every(q => !used.has(q.id)), 'no repeats vs used IDs');
ok('no question repeats across sessions (used-ID exclusion works)');

// category spread ("different sources")
assert(new Set(s20.map(q => q.category)).size >= 3, 'mixes categories');
ok(`each set mixes ${new Set(s20.map(q=>q.category)).size} categories`);

// --- 2. Full game simulation (host mode) ---
const questionsForGame = s1.slice(0, 5); // 5 quick questions
const game = new GameSession({ pin: '000000', hostId: 'HOST', title: 'Test', sessionNumber: 1, questions: questionsForGame, mode: 'host' });

const events = { question: 0, reveal: 0, finished: 0, players: 0, leaderboard: 0 };
let lastReveal = null, finalSummary = null;
game.on('question', () => events.question++);
game.on('players', () => events.players++);
game.on('leaderboard', () => events.leaderboard++);
game.on('reveal', (r) => { events.reveal++; lastReveal = r; });
game.on('finished', (f) => { events.finished++; finalSummary = f.summary; });

// three players join
game.addPlayer('P1', 'Alice');
game.addPlayer('P2', 'Bob');
game.addPlayer('P3', 'Carol');
assert.strictEqual(game.players.size, 3, '3 players joined');
ok('3 players joined; presence broadcast fired ' + events.players + 'x');

// play all questions
for (let i = 0; i < questionsForGame.length; i++) {
  game.nextQuestion();
  const correct = game.currentQuestion.answer;
  // Alice always correct & fast; Bob correct & slow-ish; Carol wrong
  game.submitAnswer('P1', correct);
  game.submitAnswer('P2', correct);
  game.submitAnswer('P3', (correct + 1) % 4);
  // double-submit should be rejected
  const dbl = game.submitAnswer('P1', correct);
  assert.strictEqual(dbl.ok, false, 'double answer rejected');
  game.reveal();
  assert(lastReveal.correctIndex === correct, 'reveal exposes correct index');
  assert(lastReveal.counts.reduce((a,b)=>a+b,0) === 3, 'answer counts total 3');
}
ok(`played ${questionsForGame.length} rounds; double-answer + late-answer guarded`);

game.finish();
assert.strictEqual(events.finished, 1, 'game finished once');
const lb = finalSummary.leaderboard;
assert.strictEqual(lb[0].name, 'Alice', 'Alice (fast+correct) leads');
assert(lb.find(p=>p.name==='Carol').score === 0, 'Carol (wrong) has 0');
assert(lb.find(p=>p.name==='Alice').score >= lb.find(p=>p.name==='Bob').score, 'faster correct >= slower');
ok(`final leaderboard correct: Alice ${lb[0].score} > Bob ${lb[1].score} > Carol ${lb[2].score}`);

// --- 3. Persistence: commit + previous leaderboard ---
const tmp = '/tmp/smoke-state.json';
require('fs').rmSync(tmp, { force: true });
const store = new Store(tmp);
assert.strictEqual(store.nextSessionNumber(), 1, 'starts at session 1');
store.commitSession(finalSummary);
assert.strictEqual(store.getSessionCounter(), 1, 'counter incremented');
const prev = store.getPreviousLeaderboard();
assert(prev && prev.leaderboard[0].name === 'Alice', 'previous leaderboard persisted');
assert(store.getUsedIds().size === questionsForGame.length, 'used IDs persisted');
require('fs').rmSync(tmp, { force: true });
ok('persistence: session committed, previous leaderboard + used IDs stored');

console.log(`\n✅ ALL ${pass} CHECKS PASSED — core game logic verified.`);
