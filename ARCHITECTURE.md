# AI Trivia — Architecture

## Overview
A real-time, multiplayer MCQ trivia game for live sessions (200+ participants) with a presenter/host screen and a player-join screen. Built on Node.js + Socket.IO, designed to run on Azure with horizontal scale-out.

## Components
| Layer | Technology | Responsibility |
|---|---|---|
| Real-time server | Node.js + Express + **Socket.IO** | Sessions, timed rounds, scoring, live leaderboard, participant presence |
| Scale-out bus | **Azure Cache for Redis** (`@socket.io/redis-adapter`) | Broadcasts events across multiple app instances so all users stay in sync |
| Persistence | JSON file (dev) → **Azure Cosmos DB / Azure SQL** (prod) | Session counter, used-question IDs (no repeats across the year), historical leaderboards |
| Hosting | **Azure App Service (Linux)** or **Azure Container Apps** | Runs the container(s); WebSockets + session affinity enabled |
| Clients | Static HTML/JS (`presenter.html`, `index.html`) | Presenter display (screen-shared) and player phones/laptops |

## How a session works
1. **Presenter** opens `presenter.html`, picks a mode, clicks *Create session* → server generates a 6-digit PIN and pre-selects 20 questions for that session number.
2. **Players** open the site, enter the PIN + name, and appear live in the lobby ("who joins in").
3. Presenter starts. For each of the 20 questions:
   - Question + 4 options broadcast to everyone; a 15-second countdown starts (server-authoritative `deadline`).
   - Players submit one answer; the **correct answer is never sent to clients until reveal** (prevents cheating).
   - On reveal: correct option, answer distribution, and updated **live leaderboard** are pushed.
4. After 20 questions the **final leaderboard** is shown and persisted. The next session automatically displays the **previous session's leaderboard**.

## Two presenter modes (requirement #14)
- **Host-controlled** — presenter manually clicks *Reveal* and *Next*. Full control while narrating.
- **Auto-run** — each question auto-advances on the 15s timer; reveal and next happen automatically.

## Scoring
`points = 1000 − 500 × (responseTime / 15s)` for a correct answer (so faster = more, min 500), `0` if wrong. A small streak bonus (+100) rewards 3+ correct in a row. Fully tunable in `server/gameManager.js`.

## Progressive difficulty (requirements #4, #9, #10)
The bank has **402 questions** across 10 categories, tagged `beginner / intermediate / advanced`. `server/questionService.js` maps the session number to a difficulty mix:
- **Sessions 1–4:** 80% beginner / 20% intermediate — AI basics & fundamentals.
- **Sessions 5–10:** intermediate-weighted.
- **Sessions 11–16:** advanced-weighted.
- **Sessions 17+:** ~85% advanced (deep tech).
Used-question IDs are persisted so questions don't repeat across the year, and each 20-question set is mixed across categories ("different sources").

## Why this scales to 200+ users
- WebSocket fan-out is O(users) per event; a single P1v3 instance handles a few hundred easily.
- For headroom / redundancy, run **2+ instances**; the **Redis adapter** relays room broadcasts between them, and **session affinity** keeps each socket pinned to one instance.
- The server holds transient game state in memory (fast); only end-of-session results are persisted.

## Anti-cheat / integrity
- Correct answers withheld until reveal.
- Server-authoritative timing (`deadline` timestamp); late answers rejected.
- One answer per player per question (server-enforced).

## Data model (persistence interface — `server/store.js`)
```
sessionCounter : int
usedIds        : [questionId]
history        : [{ sessionNumber, endedAt, title, playerCount, leaderboard:[{rank,name,score}] }]
```
Swap the file implementation for Cosmos DB by re-implementing the same methods; the game engine is storage-agnostic.
