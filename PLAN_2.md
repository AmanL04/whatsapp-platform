# WhatsApp Companion Platform — PLAN 2

> Revised architecture. Hand this to Claude Code.
> Start with: "Read PLAN_2.md and let's start with Step 1 — the SQLite store."

---

## What This Is

A **self-hosted WhatsApp infrastructure server** that any app can plug into via a
simple registration. It solves the hard part — connecting to WhatsApp, storing
messages and media, enforcing permissions, delivering webhooks — so apps built on
top of it never have to think about any of that.

Apps are not plugins. They are external. They register once and receive events.

---

## The Mental Model

```
WhatsApp (personal or business account)
  │
  ▼
┌─────────────────────────────────────────────────┐
│  WA Companion Server (this repo)                │
│                                                 │
│  Baileys ──► message/media store (SQLite)       │
│          ──► webhook dispatcher                 │
│          ──► REST API (scoped per app)          │
│          ──► dashboard (app management UI)      │
└──────────┬──────────────────────────────────────┘
           │  webhooks + API calls
    ┌──────┼──────┐
    ▼      ▼      ▼
 tasks   recap  summary      ← external apps, live anywhere,
  app     app    app           built in any language
```

The server never knows what apps do with the data. It just delivers events
faithfully and answers API queries within the app's registered permissions.

---

## App Registration Model

An "app" is a registration record — a row in a database.
No code runs inside this server on behalf of an app.

```typescript
interface App {
  id: string
  name: string
  description: string

  webhook: {
    globalUrl: string           // fallback for all events
    secret: string              // HMAC-SHA256 signing key
    events: {
      name: string              // e.g. 'message.received'
      url?: string              // overrides globalUrl for this event only
    }[]
  }

  api: {
    key: string                 // Bearer token for inbound API calls
    permissions: Permission[]
  }

  scope: {
    chatTypes: ('dm' | 'group')[]
    specificChats?: string[]    // empty = all chats of allowed types
  }
}

type Permission =
  | 'messages.read'
  | 'chats.read'
  | 'media.read'
  | 'media.download'
  | 'messages.send'             // explicit opt-in, not granted by default
```

---

## Events

Every event is POSTed to the app's webhook URL:

```json
{
  "event": "message.received",
  "appId": "app_abc123",
  "timestamp": "2026-04-06T09:00:00Z",
  "payload": { ...scoped to app permissions and chat scope }
}
```

Signed with `X-Webhook-Signature: sha256=<hmac>` using the app's secret.

| Event | Triggered when |
|---|---|
| `message.received` | Any message arrives in a scoped chat |
| `media.received` | Image / video / audio / doc received |
| `message.sent` | You send a message |
| `chat.updated` | Unread count or last message changes |

Apps only receive events they subscribed to, only for chats in their scope.

---

## REST API (per app, scoped)

All requests carry `Authorization: Bearer <api_key>`.

```
GET  /api/chats
GET  /api/messages?chatId=&since=&limit=
GET  /api/media?chatId=
GET  /api/media/:id/download          (requires media.download permission)
POST /api/messages/send               (requires messages.send permission)
```

Every query is automatically filtered to the app's registered scope.
An app scoped to specific DMs cannot query groups even if it knows the chat ID.

---

## Auth Strategy

**Now — single user, localhost:**
- Dashboard has no login screen — only reachable on localhost
- Static `DASHBOARD_SECRET` in `.env` as a simple passphrase on first open
- Session cookie set for the browser, expires in 7 days
- Per-app API keys are generated at registration time in the dashboard

**Later — expose externally:**
- WhatsApp OTP auth for the dashboard
- Baileys sends an OTP to your own number, you enter it, session set
- No email provider needed, consistent with the product

**Future — self-hosted by others:**
- Same OTP flow, runs on their machine with their number
- You ship software not a service — their session never leaves their server
- Docker image + one-click deploy guide (Railway, Render, or bare VPS)
- Hosting other people's WhatsApp sessions is a serious trust problem — self-hosting sidesteps it entirely

---

## Current Repo State

Baileys is connected and working ✅

```
whatsapp/
├── index.ts                        ✅ needs cleanup (remove old plugin wiring)
├── package.json                    ✅ deps installed
├── tsconfig.json                   ✅
├── core/
│   ├── adapter.ts                  ✅ WAAdapter interface — keep as is
│   ├── types.ts                    ✅ Message, Chat, Media — keep, extend
│   └── runtime.ts                  ✅ repurpose as event dispatcher
├── adapters/
│   ├── baileys/index.ts            ✅ connected — store not yet wired
│   ├── beeper/                     🔲 stub, ignore for now
│   └── whatsmeow/                  🔲 stub, ignore for now
├── plugins/                        ⚠️  old model — delete this folder
├── apps/                           🔲 create this — registry + dispatcher live here
├── dashboard/                      🔲 not started
└── data/                           ✅ auth working, db not yet created
```

---

## Build Order

### Step 1 — SQLite Store

Wire Baileys events into SQLite. Everything else depends on this.

```bash
npm install better-sqlite3 @types/better-sqlite3
```

Create `data/whatsapp.db` with these tables:

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
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER DEFAULT 0,
  last_message_at INTEGER,
  unread_count INTEGER DEFAULT 0
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

In `BaileysAdapter`:
- On `messages.upsert` → INSERT into messages
- On `chats.upsert` → UPSERT into chats
- Implement `getMessages(query)` as SELECT with WHERE filters
- Implement `getChats()` as SELECT ORDER BY last_message_at DESC

---

### Step 2 — App Registry

Add to `data/whatsapp.db`:

```sql
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  webhook_global_url TEXT,
  webhook_secret TEXT,
  webhook_events TEXT,        -- JSON: [{name, url?}]
  api_key TEXT NOT NULL,
  permissions TEXT,           -- JSON: ['messages.read', ...]
  scope_chat_types TEXT,      -- JSON: ['dm', 'group']
  scope_specific_chats TEXT,  -- JSON: ['chatId1', ...] or null for all
  active INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  event TEXT,
  payload TEXT,
  status TEXT,                -- 'delivered' | 'failed' | 'retrying'
  attempts INTEGER DEFAULT 0,
  last_attempt_at INTEGER,
  response_status INTEGER
);
```

Create `apps/registry.ts`:
- `registerApp(input)` → generates id, api_key, webhook_secret, inserts row
- `listApps()` → returns all active apps
- `getAppByKey(apiKey)` → returns app or null
- `getSubscribedApps(eventName, chatId)` → returns apps that should receive this event

---

### Step 3 — Webhook Dispatcher

Create `apps/dispatcher.ts`:

```typescript
export async function dispatch(eventName: string, payload: unknown, chatId: string) {
  const apps = registry.getSubscribedApps(eventName, chatId)
  for (const app of apps) {
    const url = app.webhook.events.find(e => e.name === eventName)?.url
               ?? app.webhook.globalUrl
    await deliverWithRetry(app, url, eventName, payload)
  }
}
```

- Sign every delivery: `X-Webhook-Signature: sha256=<hmac-sha256>`
- Retry on failure: 3 attempts, exponential backoff (1s → 5s → 30s)
- Log every attempt to `webhook_deliveries` table
- Call `dispatch()` from `BaileysAdapter` on every message and media event

---

### Step 4 — Scoped REST API

```bash
npm install express @types/express
```

Auth middleware — resolves app from Bearer token, attaches to request:

```typescript
app.use('/api', (req, res, next) => {
  const key = req.headers.authorization?.replace('Bearer ', '')
  const app = registry.getAppByKey(key)
  if (!app) return res.status(401).json({ error: 'invalid api key' })
  req.waApp = app
  next()
})
```

Every endpoint checks permissions and enforces scope before returning data.
An app with `scope.specificChats = ['chat_123']` cannot query any other chat
regardless of what it passes as `chatId`.

---

### Step 5 — Dashboard (App Management UI)

Local Vite + React app for registering and managing apps.

```bash
cd dashboard
npm create vite@latest . -- --template react-ts
npm install
```

Pages:

| Route | Purpose |
|---|---|
| `/` | Server status, connected account, events per minute |
| `/apps` | List registered apps, toggle active/inactive |
| `/apps/new` | Registration form — name, webhook URL, events, permissions, scope |
| `/apps/:id` | Detail view — edit, reveal API key, webhook secret, delivery log |
| `/logs` | Recent webhook delivery log across all apps |

Auth: on first open, prompt for `DASHBOARD_SECRET` from `.env`.
Set a session cookie valid for 7 days. No login screen after that.

---

## .env

```
PORT=3000
DASHBOARD_SECRET=pick-something-long-and-random
```

## .gitignore

```
node_modules/
data/auth/
data/*.db
.env
dist/
dashboard/node_modules/
dashboard/dist/
```

**Never commit `data/auth/`** — it contains your WhatsApp session keys.

---

## Adapter Swap

If Baileys ever breaks, this is the only line that changes in `index.ts`:

```typescript
const adapter = new BaileysAdapter('./data/auth')    // today
const adapter = new BeeperAdapter({ baseUrl: '...' }) // fallback
```

Registry, dispatcher, REST API, dashboard — all untouched.

---

## What an External App Looks Like

```typescript
// my-tasks-app/webhook.ts — lives in a completely separate repo
import crypto from 'crypto'

app.post('/webhook', (req, res) => {
  const sig = req.headers['x-webhook-signature']
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WA_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex')

  if (sig !== expected) return res.status(401).end()

  const { event, payload } = req.body

  if (event === 'message.received') {
    // app's own logic — server doesn't know or care what happens here
    const task = extractTask(payload.content)
    if (task) db.insertTask(task)
  }

  res.status(200).end()
})
```

This app knows nothing about Baileys, SQLite, or WhatsApp internals.
It just verifies the signature and handles the event.

---

*Written in Claude.ai chat mode — continue in Claude Code.*
*Start with: "Read PLAN_2.md and let's begin with Step 1 — the SQLite store."*
