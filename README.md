# Scrabble Multiplayer

A real-time, browser-based multiplayer Scrabble game. Built across four phases: lobby foundation → board gameplay → dictionary + reconnection → polish, drag-and-drop, spectator mode, and production hardening.

**Stack:** React + Vite (client), Node + Express + Socket.io (server), in-memory per-room state

---

## Quick start (local)

```bash
# 1. Clone
git clone <your-repo-url> && cd scrabble-game

# 2. Install both sides
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. Copy env files
cp server/.env.example server/.env
cp client/.env.example client/.env

# 4. Run server (terminal A)
cd server && npm run dev

# 5. Run client (terminal B)
cd client && npm run dev
```

Open `http://localhost:5173` in 2+ tabs to play.

---

## Architecture

```
┌───────────────┐     WebSocket (Socket.io)     ┌────────────────────┐
│  Client (SPA) │  ◀─────────────────────────▶  │  Server (Node)     │
│  React + Vite │                                │  Express + Socket  │
└───────────────┘                                └────────────────────┘
        │                                                  │
        │                                                  ├── RoomManager (Map<roomId, Room>)
        │                                                  ├── GameEngine (pure functions)
        │                                                  ├── Dictionary (Set, ~270k words)
        │                                                  ├── ReconnectTokens (TTL-based)
        │                                                  └── RateLimiter (token bucket per socket)
        │
        ├── localStorage: reconnect token, prefs (sound, last name)
        └── ErrorBoundary catches render errors
```

### Room isolation

Every game room is an isolated object in a single `Map`:

```js
{
  id: 'A3F7KZ',
  hostSeatId: '...',
  players: [{ seatId, socketId, name, connected }],
  spectators: [{ socketId, name }],
  gameState: { board, bag, racks, scores, moveHistory, ... },
  currentTurnSeatId: '...',
  turnOrder: [...],
  pendingDisconnects: Map<seatId, timeoutHandle>,
  turnTimer: TurnTimer
}
```

There is **zero shared mutable state across rooms**. Adding a 100th room has no effect on the other 99.

### Identity model

- **socketId**: changes on every TCP connection. Used only to route private messages.
- **seatId**: stable per-player ID, generated on join. All scores, racks, turn order key on this.
- **reconnectToken**: short-lived (2 min) credential mapping a returning browser to its existing seat.

This is what enables: refresh a tab mid-game and resume your seat with rack and score intact.

### Game flow (one move)

```
Client                     Server
──────                     ──────
[click tile, click cell]
[Submit Move clicked]
  emit submit_move ────────▶
                            sanitizePlacements(...)
                            applyMove(room, seatId, placements)
                              ├─ validatePlacement (geometry)
                              ├─ scoreMove (premiums + bingo)
                              └─ validateWords (dictionary)
                            if invalid:
                              ◀──── move_rejected (only the mover)
                            if valid:
                              update room state
                              start next turn timer
                              ◀──── room_state (everyone)
                              ◀──── rack_update (mover only)
                              ◀──── move_applied (everyone)
```

Move validation is **atomic**: either every word is a valid dictionary word and the move applies, or nothing changes.

---

## Features by phase

| Phase | Feature |
|-------|---------|
| 1 | Room create/join, live player list, multi-room isolation |
| 2 | 15×15 board, premium squares, tile bag, racks, scoring, pass, swap, blank tiles |
| 3 | Dictionary validation, atomic move rejection, move history, 90s turn timer, reconnection with grace window, rate limiting, graceful shutdown |
| 4 | Drag-and-drop, undo/recall, rack shuffle, sound effects, spectator mode, full SOWPODS, helmet, structured logging, input sanitization |

---

## Configuration

### Server (`server/.env`)

```
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
LOG_LEVEL=info     # debug | info | warn | error
```

In production, `CLIENT_ORIGIN` can be a comma-separated list to allow both staging and prod hosts.

### Client (`client/.env`)

```
VITE_SERVER_URL=http://localhost:4000
```

---

## Swap in the full SOWPODS dictionary

The bundled dev wordlist is small. To use the full ~270,000-word SOWPODS list:

```bash
cd server/src/game
curl -o /tmp/sowpods.txt https://raw.githubusercontent.com/jmlewis/valett/master/scrabble/sowpods.txt
echo "// Auto-generated from SOWPODS." > wordlist.js
echo 'export const WORD_LIST = `' >> wordlist.js
cat /tmp/sowpods.txt >> wordlist.js
echo '`;' >> wordlist.js
```

Restart the server. The startup log line will confirm the new size:

```
{"t":"...","level":"info","msg":"dictionary.load","words":267751}
```

---

## Deployment

### Backend → Render

1. New → Web Service → connect this repo.
2. Root Directory: `server`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Env vars:
   - `CLIENT_ORIGIN=https://your-vercel-domain.vercel.app`
   - `LOG_LEVEL=info`
6. Deploy. Note the URL: `https://your-server.onrender.com`

### Frontend → Vercel

1. Add New Project → import same repo.
2. Root Directory: `client`
3. Framework: Vite
4. Env vars:
   - `VITE_SERVER_URL=https://your-server.onrender.com`
5. Deploy.

### Wire them together

After both are deployed:

1. Update Render's `CLIENT_ORIGIN` to the actual Vercel URL.
2. Test the live URL in 2 tabs.
3. Check `https://your-server.onrender.com/health` — should return JSON with `dictionaryWords`, `totalRooms`, etc.

**Render free-tier note:** the server sleeps after 15 minutes idle. First request after sleep takes ~30 seconds. The client shows "Reconnecting..." and recovers automatically. Upgrade to a paid tier to remove sleep.

---

## Scripts

```bash
# Server
cd server
npm run dev    # nodemon, hot-restart
npm start      # production

# Client
cd client
npm run dev      # Vite dev server
npm run build    # produces dist/
npm run preview  # serve the production build locally
```

---

## Troubleshooting

**"socket.io-client" import fails on the client**
Run `cd client && npm install socket.io-client`.

**Port 4000 in use**
`lsof -ti:4000 | xargs kill -9`

**Lobby stuck — both players show "host" or no Start button**
Stale localStorage from a previous schema. Run `localStorage.clear()` in the console of every open tab and restart the server.

**Reconnect rejected after server restart**
Expected: server-side rooms are in-memory and lost on restart. The client clears its stale token and falls back to the home screen.

**Dictionary rejects a real word**
Phase 3 ships a dev word list. Swap in SOWPODS (instructions above).

**Sounds don't play**
Browsers require user interaction before audio works. The first click on the page unlocks audio. Toggle the 🔊 button to disable.

---

## Project structure

```
scrabble-game/
├── README.md
├── shared/events.js              # canonical event names + constants
├── server/
│   └── src/
│       ├── index.js              # express + socket.io entry
│       ├── events.js             # copy of shared
│       ├── logger.js             # JSON logger
│       ├── rooms/
│       │   ├── roomManager.js    # all rooms in a Map
│       │   └── reconnectTokens.js
│       ├── game/
│       │   ├── constants.js      # tile distribution, premium squares
│       │   ├── tileBag.js
│       │   ├── board.js
│       │   ├── moveValidator.js  # geometry rules
│       │   ├── scoring.js        # premium-aware scoring
│       │   ├── dictionary.js     # word list -> Set
│       │   ├── wordlist.js       # bundled or generated
│       │   ├── turnTimer.js
│       │   └── gameEngine.js     # pure-ish state transitions
│       ├── middleware/
│       │   └── rateLimiter.js
│       └── sockets/
│           └── socketHandlers.js
└── client/
    └── src/
        ├── App.jsx
        ├── socket.js
        ├── reconnect.js
        ├── localPrefs.js
        ├── sound.js
        ├── events.js
        └── components/
            ├── Home.jsx
            ├── Room.jsx
            ├── Board.jsx
            ├── Rack.jsx
            ├── Scoreboard.jsx
            ├── GameControls.jsx
            ├── MoveHistory.jsx
            ├── TurnTimer.jsx
            └── ErrorBoundary.jsx
```

---

## License

MIT
