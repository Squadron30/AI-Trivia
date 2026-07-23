'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Simple JSON-file persistence for local/dev use. It stores:
 *   - sessionCounter: how many sessions have been played (drives difficulty ramp)
 *   - usedIds: question IDs already used this year (avoid repeats)
 *   - history: past session summaries + their final leaderboards
 *
 * FOR AZURE PRODUCTION: replace this class with an Azure Cosmos DB (or Azure
 * SQL / Table Storage) implementation exposing the same async methods. The
 * game server only depends on this interface, so the swap is isolated.
 */
class Store {
  constructor(file) {
    this.file = file || path.join(__dirname, '..', 'data', 'trivia-state.json');
    this._ensure();
    this.state = this._load();
  }

  _ensure() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { sessionCounter: 0, usedIds: [], history: [] };
    }
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  getSessionCounter() { return this.state.sessionCounter; }
  nextSessionNumber() { return this.state.sessionCounter + 1; }

  getUsedIds() { return new Set(this.state.usedIds); }

  /** Called when a session finishes: bump counter, record used IDs + result. */
  commitSession(summary) {
    this.state.sessionCounter += 1;
    const merged = new Set([...this.state.usedIds, ...summary.questionIds]);
    this.state.usedIds = [...merged];
    this.state.history.unshift({
      sessionNumber: this.state.sessionCounter,
      endedAt: new Date().toISOString(),
      title: summary.title,
      leaderboard: summary.leaderboard.slice(0, 20),
      playerCount: summary.playerCount,
    });
    this.state.history = this.state.history.slice(0, 50); // keep last 50
    this._save();
  }

  /** Leaderboard from the most recently completed session (shown at next start). */
  getPreviousLeaderboard() {
    const last = this.state.history[0];
    return last ? { sessionNumber: last.sessionNumber, title: last.title, leaderboard: last.leaderboard } : null;
  }

  getHistory() { return this.state.history; }
}

module.exports = Store;
