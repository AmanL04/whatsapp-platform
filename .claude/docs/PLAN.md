# WhatsApp Companion Platform — Build Plan

> Hand this file to Claude Code. It has everything needed to continue building.

---

## What We're Building

A **personal WhatsApp companion platform** with a plugin architecture. One codebase,
one place to keep adding apps. Plugins share a single connection to WhatsApp so each
new idea is just a new file in `plugins/`.

**First milestone:** Baileys connected, QR scanned, messages flowing, three plugins
running end-to-end, basic dashboard showing output.

---

## Current State of the Repo

The scaffold is already in place. Run `find . -type f | grep -v node_modules` to see it.

```
whatsapp/
├── index.ts                        ✅ entrypoint — wires adapter + plugins
├── package.json                    ✅ deps defined, not yet installed
├── tsconfig.json                   ✅
├── PLAN.md                         ✅ this file
├── core/
│   ├── adapter.ts                  ✅ WAAdapter interface (the contract)
│   ├── types.ts                    ✅ Message, Chat, Media, PluginContext types
│   └── runtime.ts                  ✅ PluginRuntime — event dispatch + plugin registry
├── adapters/
│   ├── baileys/
│   │   └── index.ts                ✅ BaileysAdapter (partial — store not wired yet)
│   ├── beeper/                     🔲 stub only, implement later if needed
│   └── whatsmeow/                  🔲 stub only, Go — future escape hatch
├── plugins/
│   ├── daily-summary/
│   │   └── index.ts                ✅ skeleton — LLM call is a TODO placeholder
│   ├── content-recap/
│   │   └── index.ts                ✅ skeleton — download logic is a TODO
│   └── task-extractor/
│       └── index.ts                ✅ skeleton — regex commitment detection, needs SQLite
├── dashboard/                      🔲 not started
├── data/                           🔲 created, empty — auth + SQLite will live here
└── research/
    └── connection-layer-research.md ✅ full research doc
```

---

## Step 1 — Install & Connect (do this first)

```bash
cd /Users/amanl04/Documents/Work/Projects/whatsapp
npm install
npm run dev
```

A QR code will print in the terminal. Scan it with WhatsApp on your phone
(Settings → Linked Devices → Link a Device). Auth is saved to `data/auth/`
so you only scan once.

**Expected output after scan:**
```
[baileys] connected
[runtime] registered plugin: daily-summary
[runtime] registered plugin: content-recap
[runtime] registered plugin: task-extractor
[main] connected — starting plugin runtime
```

**If it fails:** Most common issues:
- Node version too old — needs Node 17+. Run `node -v` to check.
- Baileys version mismatch — check `node_modules/@whiskeysockets/baileys/package.json`
  and align imports in `adapters/baileys/index.ts` if the API has changed.

---

## Step 2 — Wire the Baileys Store (messages in SQLite)

Right now `getChats()` and `getMessages()` throw "wire up a store first".
Baileys ships a `makeInMemoryStore` for dev, but we want SQLite for persistence.

**Task:** Implement a proper store in `adapters/baileys/store.ts`.

Two options:

### Option A — Baileys in-memory store (quick, good for dev)
```typescript
import { makeInMemoryStore } from '@whiskeysockets/baileys'
const store = makeInMemoryStore({})
store.bind(sock.ev)
// then getChats() = store.chats.all()
// getMessages({ chatId }) = store.messages[chatId]?.array ?? []
```

### Option B — SQLite with better-sqlite3 (recommended for production)
```bash
npm install better-sqlite3 @types/better-sqlite3
```

Schema to create in `data/whatsapp.db`:
```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  content TEXT,
  type TEXT DEFAULT 'text',
  timestamp INTEGER,
  is_from_me INTEGER DEFAULT 0,
  is_group INTEGER DEFAULT 0,
  group_name TEXT,
  reply_to TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER DEFAULT 0,
  last_message_at INTEGER,
  unread_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  chat_id TEXT,
  from_name TEXT,
  content TEXT,
  confidence TEXT,
  score INTEGER,
  created_at INTEGER,
  done INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  type TEXT,
  local_path TEXT,
  mime_type TEXT,
  caption TEXT,
  timestamp INTEGER,
  sender_name TEXT
);
```

Wire it into `BaileysAdapter`:
- On `messages.upsert` → INSERT into messages table
- On `chats.upsert` → INSERT/UPDATE chats table
- `getMessages(query)` → SELECT with WHERE clause on chat_id and timestamp
- `getChats()` → SELECT from chats ORDER BY last_message_at DESC

---

## Step 3 — Complete the Plugins

### 3a. daily-summary — wire LLM

Replace the placeholder in `plugins/daily-summary/index.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env

const summary = await anthropic.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 500,
  messages: [{
    role: 'user',
    content: `Summarise these WhatsApp messages from the last 24 hours concisely:\n\n${block}`
  }]
})
```

Add `@anthropic-ai/sdk` to package.json and set `ANTHROPIC_API_KEY` in `.env`.
Add `dotenv` package and call `config()` at the top of `index.ts`.

### 3b. task-extractor — persist to SQLite

Replace the TODO in `plugins/task-extractor/index.ts`:
- Insert detected task into `tasks` table
- Add a `getTasks()` method to `WAAdapter` and implement in `BaileysAdapter`

### 3c. content-recap — download media

Replace the TODO in `plugins/content-recap/index.ts`:
```typescript
const buffer = await adapter.downloadMedia(media.id)
const ext = media.mimeType.split('/')[1] ?? 'bin'
const filename = `${media.id}.${ext}`
const dest = path.join(recapDir, filename)
fs.writeFileSync(dest, buffer)
log(`saved: ${dest}`)
```

Implement `downloadMedia` in `BaileysAdapter`:
```typescript
async downloadMedia(mediaId: string): Promise<Buffer> {
  // Baileys: downloadMediaMessage(msg, 'buffer')
  // You need the original raw message object — store it in SQLite raw_json column
  // then: const raw = JSON.parse(getMessageById(mediaId).raw_json)
  //       return await downloadMediaMessage(raw, 'buffer', {})
}
```

---

## Step 4 — Scheduled Plugin Runner

The `Plugin` type has a `schedule` field (cron string) but nothing runs it yet.
Wire up `node-cron` in the runtime:

```bash
npm install node-cron @types/node-cron
```

Add to `core/runtime.ts`:
```typescript
import cron from 'node-cron'

// in start():
for (const p of this.plugins) {
  if (p.schedule) {
    cron.schedule(p.schedule, () => this.runPlugin(p))
    console.log(`[runtime] scheduled ${p.name}: ${p.schedule}`)
  }
}
```

---

## Step 5 — Dashboard

A minimal local web UI to see plugin output without reading the terminal.

**Recommended stack:** Vite + React + Tailwind (all local, no auth needed)

```bash
cd dashboard
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss && npx tailwindcss init
```

**What to show:**

| Route | Content |
|---|---|
| `/` | Recent messages, live-updating |
| `/tasks` | Task list from task-extractor, mark done |
| `/media` | Content recap — grid of media, swipe to keep/discard |
| `/summary` | Latest daily summary output |

**How to connect dashboard to backend:**

Add a small Express server to `index.ts` that exposes:
```
GET  /api/chats
GET  /api/messages?chatId=&limit=
GET  /api/tasks
GET  /api/media
GET  /api/summaries
```

Or use a WebSocket to push plugin `notify()` calls to the dashboard in real time.

---

## Step 6 — .gitignore and .env

Create `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Create `.gitignore`:
```
node_modules/
data/auth/
data/*.db
.env
dist/
```

**Never commit** `data/auth/` — it contains your WhatsApp session keys.

---

## Key Architectural Rules (don't break these)

1. **Plugins import from `core/` only** — never from `adapters/` directly
2. **`WAAdapter` is the only contract** — swapping adapters = changing one line in `index.ts`
3. **`data/` is ephemeral** — treat it like a local cache, not source of truth
4. **One process** — Baileys + plugin runtime + Express all run in the same Node process

---

## Swapping Adapters Later

When you want to drop the Beeper or try whatsmeow, the change is exactly this in `index.ts`:

```typescript
// Before
const adapter = new BaileysAdapter('./data/auth')

// After (Beeper)
const adapter = new BeeperAdapter({ baseUrl: 'http://localhost:23373' })

// After (whatsmeow via HTTP sidecar)
const adapter = new WhatsmeowAdapter({ port: 8080 })
```

Nothing else changes. Plugins, runtime, dashboard — all untouched.

---

## Open Questions to Decide While Building

- **Notification delivery:** Right now `notify()` just logs. Options: terminal, desktop
  notification (node-notifier), Telegram bot to yourself, or push to dashboard via WS.
- **LLM for task extraction:** Simple regex works for now but an LLM call on each message
  would be much better — decide if latency/cost is acceptable for personal use.
- **Multi-account:** Baileys supports multiple sessions. Worth designing for from the start
  if you ever want to run this for others.

---

## Useful Commands

```bash
npm run dev          # start with hot reload (tsx watch)
npm run typecheck    # check types without running
ls data/auth/        # confirm session is saved after QR scan
sqlite3 data/whatsapp.db ".tables"   # inspect the database
```

---

*This plan was written in Claude.ai chat mode. Continue in Claude Code.*
