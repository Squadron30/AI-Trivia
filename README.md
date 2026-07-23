# 🤖 AI Trivia

A real-time, multiplayer **AI-themed MCQ trivia game** for live sessions — built for a year-long internal program.

- **Configurable questions per session** (default 20; presenter picks 5–50), **15 seconds each**
- **402-question bank** across 10 AI categories, beginner → advanced
- **Progressive difficulty**: first 4 sessions cover fundamentals, then it goes deeper each session
- **Live leaderboard** that updates as answers arrive; previous session's board shown at each start
- **Presenter screen** to share on your projector + **player join screen** for phones/laptops
- **See who joins** in real time
- **Two modes**: host it manually, or let it auto-run on the timer
- **Azure-ready** with Redis scale-out for **200+ concurrent players**

## Quick start (local)
```bash
npm install
npm start
```
- Presenter (screen-share this): http://localhost:3000/presenter.html
- Players join at: http://localhost:3000/

Create a session on the presenter screen, share the 6-digit PIN, and players join.

## Project layout
```
ai-trivia/
├── server/
│   ├── server.js           Express + Socket.IO wiring
│   ├── gameManager.js      Rounds, 15s timer, scoring, leaderboard
│   ├── questionService.js  Bank loader + progressive session plan
│   └── store.js            Persistence (file → swap for Cosmos DB)
├── public/
│   ├── presenter.html      Host / big-screen display
│   └── index.html          Player join + answer screen
├── questions/              402 questions in 7 category files + built bank
├── azure/main.bicep        Azure infra (App Service + Redis)
├── Dockerfile
├── scripts/                Bank builder + smoke test
├── ARCHITECTURE.md
└── DEPLOYMENT.md
```

## Editing questions
Add/adjust JSON in `questions/*.json` (each item: `id, category, difficulty, q, options[4], answer (0-3), explanation`), then:
```bash
npm run build:bank
```
This validates everything and regenerates `questions/question-bank.json`.

## Access control (optional)
Set an environment variable `TRIVIA_PASSCODE` to require a shared access code before anyone can enter (a login page appears). Leave it unset for fully open access. This gates both the web pages and the real-time socket connections.

## Publish free on Render (via GitHub)
1. Push this folder to a GitHub repo.
2. On [Render](https://render.com): **New → Web Service → connect your repo**. It auto-detects `render.yaml`. (Or set manually: Runtime = Node, Build = `npm install`, Start = `npm start`, Instance = Free.)
3. Deploy. You get a public URL like `https://ai-trivia.onrender.com` — presenter at `/presenter.html`, players at `/`.

Free-tier notes: the instance sleeps after ~15 min idle (open the URL a few minutes before a session to wake it), and the local leaderboard-history file resets on restart. Upgrade to the Starter plan to remove sleep, or add a database for durable history. A single instance handles 50+ players comfortably; `REDIS_URL` is only needed to run multiple instances.

## Deploy to Azure
See **DEPLOYMENT.md** for the Azure App Service + Redis path (better for 200+ users and always-on hosting).
