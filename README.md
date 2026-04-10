# WA Companion

A self-hosted WhatsApp infrastructure server that makes WhatsApp programmable. Connect once, and any external app can plug in — an AI chat summarizer, a media gallery, a task extractor, a business order tracker — without solving the WhatsApp connection problem itself.

The server handles the hard part: authentication, message storage, reconnection, permissions, and event delivery. Apps register once, declare what they need, and receive scoped events via webhooks + a REST API. The server enforces boundaries. Apps just build features.

**What people build on it:** AI-powered daily chat summaries, full-text search across all chats, task extraction from conversations, voice note transcription, media galleries with keep/discard workflows, business order trackers, lead scoring, community onboarding bots, and more. See [`docs/PITCH.md`](docs/PITCH.md) for the full vision and marketplace strategy.

```
WhatsApp (your personal account)
  |
  v
┌─────────────────────────────────────────┐
│  WA Companion Server                    │
│                                         │
│  Baileys ──> SQLite (messages, chats)   │
│          ──> Webhook dispatcher         │
│          ──> Scoped REST API            │
│          ──> Dashboard                  │
└──────────┬──────────────────────────────┘
           |  webhooks + API
    ┌──────┼──────┐
    v      v      v
  app 1  app 2  app 3    ← external, any language
```

Apps register via the dashboard, receive signed webhook events, and pull data through the API. The server handles WhatsApp connection, message storage, permissions, and delivery. Apps handle their own logic.

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd whatsapp
npm install

# Configure
cp .env.example .env
# Edit .env — set JWT_SECRET and DB_ENCRYPTION_SECRET (see .env.example for generation commands)

# Run
npm run start
```

A QR code prints in the terminal on first run. Scan it with WhatsApp (Settings > Linked Devices > Link a Device). Auth is saved to `data/auth/` — you only scan once.

### Dashboard (local dev)

```bash
cd dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`. Proxies API calls to the server on port 6745.

## Architecture

### External Apps

Apps are external processes that register with the server. No code runs inside the server on behalf of apps.

**Registration:** via the dashboard Apps tab. Each app gets:
- **API key** (`wak_...`) — for calling the REST API
- **Webhook secret** (`whs_...`) — for verifying incoming webhook payloads (HMAC-SHA256)
- **Permissions** — `messages.read`, `chats.read`, `media.read`, `media.download`, `messages.send`
- **Scope** — which chat types (DM, group) and optionally specific chats the app can access

### Webhook Events

Events are POSTed to the app's webhook URL, signed with `X-Webhook-Signature: sha256=<hmac>`:

| Event | When |
|---|---|
| `message.received` | A message arrives in a scoped chat |
| `media.received` | Image/video/audio/document received |
| `message.sent` | You send a message |
| `message.reaction` | Emoji reaction added or removed |
| `chat.updated` | Chat metadata changes |

Delivery retries 3x with exponential backoff (1s, 5s, 30s). Delivery logs are kept for 30 days.

### REST API

All requests use `Authorization: Bearer <api_key>`. Responses are filtered to the app's scope.

```
GET  /api/chats                    — list chats (chats.read)
GET  /api/messages?chatId=&limit=  — get messages (messages.read)
GET  /api/media?type=&source=      — get media metadata (media.read)
GET  /api/media/:id/download       — download media file (media.download)
POST /api/messages/send            — send a message (messages.send)
```

Out-of-scope requests return `403`.

### Dashboard

Login via WhatsApp OTP (the server sends a code to your connected number). 1-hour session.

| Tab | Purpose |
|---|---|
| Overview | Stats dashboard — message count, chats, media, apps |
| Messages | Live message viewer — chats + messages (debug tool) |
| Media | Media grid with filters: type, sender, story vs chat |
| Apps | Register/manage external apps |
| Logs | Webhook delivery log with expandable payloads |

### Security

- **API auth:** Bearer token per app, rate limited (100 req/min)
- **Dashboard auth:** WhatsApp OTP + JWT (1-hour expiry, HttpOnly cookie)
- **Webhook signing:** HMAC-SHA256 on every delivery
- **DB encryption:** API keys and webhook secrets encrypted at rest with AES-256
- **CORS:** Disabled on `/api/*`. Dashboard locked to `DASHBOARD_ORIGIN` in prod.
- **Helmet:** Standard security headers on all responses

### Emergency Reconnect

If Baileys disconnects and you can't receive the OTP to log into the dashboard:

```bash
npm run reconnect
```

- If the server is running: signals it to reconnect (check server logs for QR)
- If the server is crashed: starts standalone Baileys, prints QR, saves auth, exits

## Deploy to Railway

### 1. Create Railway project

Connect the GitHub repo at [railway.app](https://railway.app). The `railway.toml` handles build and start configuration automatically.

### 2. Add a persistent volume

**This must be done manually in the Railway dashboard** (not configurable via `railway.toml`):

1. Go to your service > Settings > Volumes
2. Add a volume: mount path `/app/data`

This persists your SQLite database and WhatsApp auth across deploys.

### 3. Set environment variables

In Railway dashboard > Variables:

```
APP_ENV=prod
JWT_SECRET=<generate-a-random-secret>
DB_ENCRYPTION_SECRET=<generate-a-different-random-secret>
```

### 4. First deploy

Deploy triggers automatically. Check the deployment logs for a QR code — scan it with WhatsApp. The dashboard CORS origin is auto-detected from Railway's `RAILWAY_PUBLIC_DOMAIN` — no manual step needed.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `APP_ENV` | Yes | `local`, `dev`, or `prod` |
| `JWT_SECRET` | Yes | Signs dashboard JWT tokens |
| `DB_ENCRYPTION_SECRET` | Yes | Encrypts sensitive DB columns |
| `DASHBOARD_ORIGIN` | No | CORS origin for dashboard. Auto-detected on Railway via `RAILWAY_PUBLIC_DOMAIN`. Only set manually if not on Railway. |
| `PORT` | No | Server port (default: 6745) |

## Project Structure

```
index.ts                    — entrypoint (Express + Baileys + dispatcher)
core/
  adapter.ts                — WAAdapter interface
  types.ts                  — Message, Chat, Reaction, App, Permission
  events.ts                 — EventName, WebhookEnvelope
  jid.ts                    — JID normalization, identity cache, canonical resolution
adapters/baileys/
  index.ts                  — Baileys adapter (connection, normalization, events)
  store.ts                  — SQLite store (queries, encryption, row mappers — schema lives in migrations/)
apps/
  registry.ts               — app CRUD + subscription matching
  dispatcher.ts             — webhook delivery + HMAC signing + retry
  permissions.ts            — scope filtering + permission checks
  cleanup.ts                — 30-day delivery log retention
middleware/
  api-auth.ts               — Bearer token auth for /api/*
  dashboard-auth.ts         — WhatsApp OTP + JWT for /dashboard/*
routes/
  api.ts                    — scoped REST endpoints for external apps
  dashboard-api.ts          — admin endpoints for dashboard
cli/
  reconnect.ts              — emergency reconnect command
migrations/
  runner.ts                 — migration runner (sorted, transactional, idempotent)
  run.ts                    — standalone entry point (npm run migrate)
  0001_initial-schema.ts    — all tables + indexes
  0002_group-metadata-cache.ts — group participants + staleness columns
docs/
  api-reference.md              — full API docs for all endpoints
  identity-resolution.md        — WhatsApp JID/LID identity resolution design
  group-metadata-caching.md     — group metadata caching plan
  PITCH.md                      — pitch, marketplace strategy, launch phases
  competitive-landscape.md      — competitive analysis (OpenClaw, WAHA, Business API providers)
  decisions-and-constraints.md  — architectural decisions and protocol-level constraints
todos/                      — planned feature specs
dashboard/                  — Vite + React + Tailwind SPA
```

## TODO

Planned features with design docs:

| Feature | Plan | Status |
|---|---|---|
| **Platform** | | |
| [MCP server](todos/mcp-server.md) | Expose chats, messages, media, search as MCP tools for AI assistants (Claude, Cursor, etc.) | Planned |
| [App installation](todos/app-installation.md) | App manifest format, install/uninstall flow, config storage, catalog UI in dashboard | Planned |
| [First-party apps](todos/first-party-apps.md) | 6 external apps (Summary, Search, Tasks, Voice Transcribe, Media Recap, Read Later) using the webhook+API system | Planned |
| **Server** | | |
| [Mention tags](todos/mention-tags.md) | Resolve `@number` in messages to display names, render as styled chips in dashboard | Planned |
| [Send message](todos/send-message-dashboard.md) | Text input in dashboard Messages tab, new dashboard API endpoint | Planned |
| [API reference](todos/api-reference.md) | Full docs for all endpoints: params, request/response shapes, errors | [Done](docs/api-reference.md) |
| [Cache sync](todos/cache-sync.md) | Fix identity/group/chatNames cache-DB desync: missing updates, stale LID entries, startup gaps | Planned |
| [API sent tracking](todos/api-sent-tracking.md) | Track which app sent each API message, expose `sentByYou` in webhooks to prevent bot loops | Done |
| [Message edits](todos/message-edits.md) | Handle WhatsApp message edits: update content in DB, dispatch `message.edited` webhook | Planned |
