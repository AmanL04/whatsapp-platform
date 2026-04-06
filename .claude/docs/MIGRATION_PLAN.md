# Migration: Plugin Architecture → Infrastructure Server with External Apps

## Context

The current codebase is a WhatsApp companion with in-process plugins (daily-summary, task-extractor, content-recap). PLAN_2.md redefines this as an **infrastructure server** — apps are external processes that register via a dashboard, receive events via signed webhooks, and query data through a scoped REST API. The server handles WhatsApp connection, storage, permissions, and delivery — apps handle their own logic.

The Baileys adapter, SQLite store, and all connection/normalization work we've built carries over. The plugin runtime and plugin files get replaced by the app registry + webhook dispatcher.

---

## Step 1 — Database Tables for Apps & Webhook Deliveries

**Files:** `adapters/baileys/store.ts`

Add two tables to the `init()` method (CREATE TABLE IF NOT EXISTS — zero risk to existing tables):

- **`apps`** — id, name, description, webhook_global_url, webhook_secret, webhook_events (JSON), api_key, permissions (JSON), scope_chat_types (JSON), scope_specific_chats (JSON), active, created_at
- **`webhook_deliveries`** — id, app_id, event, payload, status, attempts, last_attempt_at, response_status, created_at

Add indexes on `apps(api_key)`, `apps(active)`, `webhook_deliveries(app_id, created_at)`, `webhook_deliveries(created_at)`.

Add store methods: `insertApp`, `listApps`, `getAppById`, `getAppByApiKey`, `updateApp`, `deactivateApp`, `insertDelivery`, `updateDelivery`, `getDeliveries`, `deleteOldDeliveries`.

**Sensitive column encryption:** The `api_key` and `webhook_secret` columns in the `apps` table are encrypted at rest using AES-256 with `DB_ENCRYPTION_SECRET` from `.env`. This env var is injected at runtime by Railway (never written to disk). The threat this protects against is the DB file being exfiltrated without the env vars — e.g. via a database backup, volume export, or snapshot that gets shared or leaked. The encrypted columns are unreadable without the secret. All other columns (messages, chat names) are your own WhatsApp data and don't need encryption. The store exposes `encryptField(value)` / `decryptField(value)` helpers used transparently by the app CRUD methods.

**Verify:** Server starts, `sqlite3 data/whatsapp.db ".tables"` shows new tables. Inspecting the `apps` table directly shows encrypted blobs for api_key and webhook_secret.

---

## Step 2 — Types, Events & App Registry

**Files:** `core/types.ts`, new `core/events.ts`, new `apps/registry.ts`

**types.ts** — Add `App` interface and `Permission` type. Remove `PluginContext` (no longer used after Step 9).

**events.ts** — Define `EventName` (`message.received`, `media.received`, `message.sent`, `chat.updated`) and `WebhookEnvelope` shape.

**registry.ts** — Wraps store with business logic:
- `registerApp(input)` → generates `app_` ID, `wak_` API key, `whs_` webhook secret (all via crypto.randomBytes), validates input, inserts row
- `listApps()`, `getAppByApiKey(key)`, `updateApp(id, fields)`, `deactivateApp(id)`
- `getSubscribedApps(eventName, chatId, isGroup)` → filters by event subscription, chat type scope, and specific chat scope

**Verify:** `npm run typecheck` passes.

---

## Step 3 — Webhook Dispatcher & Permissions

**Files:** new `apps/dispatcher.ts`, new `apps/permissions.ts`

**dispatcher.ts** — Core function: `dispatch(eventName, payload, chatId, isGroup)`
1. Get subscribed apps from registry
2. For each app: build envelope, resolve URL (event-specific override or globalUrl), JSON stringify, compute HMAC-SHA256 with app's webhook_secret
3. POST with headers: `Content-Type`, `X-Webhook-Signature: sha256=<hmac>`, `X-Webhook-Event`, `X-App-Id`
4. Log to webhook_deliveries table
5. Retry on failure: 3 attempts, exponential backoff (1s → 5s → 30s) via setTimeout
6. All apps dispatched concurrently via Promise.allSettled — one slow app never blocks another
7. **Startup recovery:** On server start, re-queue any `webhook_deliveries` rows with status `retrying` from before a crash. Prevents silent delivery loss when the server restarts mid-retry.

**permissions.ts** — Scope enforcement:
- `filterMessageForApp(msg, app)` → returns null if outside app's scope
- `filterChatForApp(chat, app)` → same
- `checkPermission(app, permission)` → boolean
- `scopeQuery(app, query)` → restricts MessageQuery to app's allowed chats

No new dependencies — uses native `crypto` and `fetch`.

**Verify:** Functions are importable and typecheck.

---

## Step 4 — Wire Dispatcher into Baileys Adapter

**Files:** `adapters/baileys/index.ts`, `index.ts`

**Adapter** — Add callback injection (adapter never imports from `apps/`):
```
private dispatchEvent?: (event, payload, chatId, isGroup) => void
setEventDispatcher(fn) { this.dispatchEvent = fn }
```

Dispatch calls added alongside existing handler invocations:
- `messages.upsert` → `dispatchEvent('message.received', ...)` and for fromMe: `dispatchEvent('message.sent', ...)`
- Media events → `dispatchEvent('media.received', ...)`
- `chats.upsert/update/groups.upsert` → `dispatchEvent('chat.updated', ...)`

**index.ts** — Wire it: `adapter.setEventDispatcher(dispatch)`

**Verify:** Register a test app pointing to webhook.site. Send a WhatsApp message. Confirm webhook received with correct HMAC. Check webhook_deliveries table.

---

## Step 5 — Route Split: Scoped API + Dashboard API

**Files:** new `middleware/api-auth.ts`, new `middleware/dashboard-auth.ts`, new `routes/api.ts`, new `routes/dashboard-api.ts`, `index.ts`, `dashboard/src/App.tsx`, `dashboard/vite.config.ts`

**Route structure:**
- `/api/*` — Bearer token auth, app-scoped (for external apps)
- `/dashboard/api/*` — Cookie/session auth (for built-in UI)
- `/dashboard/auth/login` — POST with DASHBOARD_SECRET, sets 7-day HttpOnly cookie

**api-auth.ts** — Middleware: read Bearer token → lookup app via registry → attach to req → 401 if invalid. Rate limited: 100 requests/min per API key (express-rate-limit).

**routes/api.ts** — Scoped endpoints with permission checks:
- `GET /api/chats` (chats.read), `GET /api/messages` (messages.read), `GET /api/media` (media.read), `GET /api/media/:id/download` (media.download), `POST /api/messages/send` (messages.send)
- Out-of-scope requests return 403 with `{ error: "chat_id is outside this app's scope" }` — explicit errors are easier to debug when building apps on top
- CORS disabled on `/api/*` — API clients (server-to-server) don't need it

**dashboard-auth.ts** — WhatsApp OTP login + JWT session:
- `POST /dashboard/auth/send-otp` — generates 6-digit code, stores with 5-min expiry, sends to connected WhatsApp number via `adapter.sendMessage()`. Rate limited: max 3 requests per 5 minutes.
- `POST /dashboard/auth/verify-otp` — validates code, issues JWT in HttpOnly cookie (1-hour expiry), signed with `JWT_SECRET` from `.env`. Rate limited: max 5 verify attempts per code to prevent brute-force.
- JWT cookie flags: `HttpOnly: true`, `SameSite: strict` (always), `Secure: true` (only when `APP_ENV=prod` — so localhost dev works over plain HTTP).
- Auth middleware for all `/dashboard/*` routes — validates JWT from cookie, 401 if expired or invalid.
- Server refuses to start if `JWT_SECRET` is not set in `.env`.
- **Emergency reconnect:** `npm run reconnect` CLI command for when Baileys loses connection and you can't receive the OTP to log into the dashboard. Two modes:
  - **Server is running:** Writes a `data/.reconnect` signal file. The running server watches for this file (via `fs.watch`), deletes it, disconnects Baileys, and calls `connect()` again — printing the QR to the server's stdout (visible in Railway logs). You scan the QR from the log viewer. No second process, no auth state race.
  - **Server is crashed:** Falls back to standalone mode — starts a minimal Baileys instance, prints QR in the terminal, saves auth to `data/auth/`, and exits. Next server start picks up the fresh auth.

**routes/dashboard-api.ts** — Admin endpoints (no app scoping):
- App management: `GET/POST /dashboard/api/apps`, `GET/PUT/DELETE /dashboard/api/apps/:id`
- Delivery logs: `GET /dashboard/api/deliveries`, `GET /dashboard/api/apps/:id/deliveries`
- Existing data: `GET /dashboard/api/chats`, `/messages`, `/tasks`, `/media`, `/summaries`
- Auth: `POST /dashboard/auth/login`, `GET /dashboard/api/auth/check`

**Dashboard changes:**
- `vite.config.ts` proxy: `/dashboard/api` and `/dashboard/auth` → localhost:3100
- `App.tsx`: change `const API = '/api'` to `const API = '/dashboard/api'`
- Add login gate: check session on mount, show OTP login screen if unauthenticated (Send OTP button → code input → verify)

**index.ts** — Replace old flat routes with mounted routers. Add:
- `helmet()` middleware for security headers (X-Frame-Options, CSP, etc.)
- CORS on `/dashboard/*` locked to `DASHBOARD_ORIGIN` from `.env`. When `APP_ENV=local`, allows any origin. When `APP_ENV=prod` or `APP_ENV=dev`, `DASHBOARD_ORIGIN` is required — server refuses to start without it.

**Verify:** curl with Bearer token hits /api/chats and gets scoped results. Dashboard loads through login flow.

---

## Step 6 — Dashboard: App Management & Logs UI

**Files:** `dashboard/src/App.tsx`

Add two tabs to existing TABS array (Messages, Tasks, Media, Summary stay):

**AppsTab:**
- List registered apps (name, status, event subscriptions)
- "Register New App" form: name, webhook URL, events (checkboxes), permissions (checkboxes), chat scope (All DMs / All Groups / Both / Specific chats)
- Scope picker shows resolved chat names (from `/dashboard/api/chats`) not raw JIDs
- On submit: show generated API key + webhook secret with copy buttons (shown once)
- App detail view: edit fields, masked secrets with reveal, delivery log, toggle active, regenerate key

**LogsTab:**
- Table of recent webhook deliveries across all apps
- Columns: timestamp, app name, event, status, attempts, response code
- Filter by app, status, date range
- Auto-refresh every 30s

**Verify:** Register an app via dashboard. See it listed. Send a WhatsApp message. See delivery in Logs tab.

---

## Step 7 — Delivery Log Cleanup

**Files:** new `apps/cleanup.ts`, `index.ts`

`cleanOldDeliveries(store, maxAgeDays=30)` → DELETE FROM webhook_deliveries WHERE created_at < cutoff

Wire into index.ts:
- Run on server start
- Schedule daily at 3am via node-cron (already a dependency)

**Verify:** Insert old test deliveries, restart server, confirm deleted.

---

## Step 8 — Remove Plugin Infrastructure

**Files:** DELETE `core/runtime.ts`, DELETE `plugins/` directory, `index.ts`, `core/types.ts`, `package.json`

- Remove all plugin imports and PluginRuntime wiring from index.ts
- Remove `PluginContext` from types.ts
- Remove `@anthropic-ai/sdk` from package.json (apps that need it carry their own)
- Keep `node-cron` (used by cleanup)

**Verify:** `npm run typecheck`. Server starts cleanly. No plugin references anywhere. Dashboard still shows historical data in Tasks/Media/Summary tabs.

---

## Step 9 — History Sync Batched Dispatch

**Files:** `adapters/baileys/index.ts`

In `messaging-history.set` handler, after storing messages, dispatch in controlled batches:
- Batch size: 50 messages
- Delay between batches: 100ms
- Prevents 10k+ messages from hammering app webhooks simultaneously

**Verify:** Delete auth, reconnect with QR. Watch batched dispatch in logs. Confirm apps receive messages.

---

## .env After Migration

```
APP_ENV=local                                       # local | dev | prod
PORT=3100
JWT_SECRET=pick-something-long-and-random
DB_ENCRYPTION_SECRET=pick-a-different-long-random-string
DASHBOARD_ORIGIN=https://your-app.up.railway.app   # required when APP_ENV=dev or APP_ENV=prod
```

`APP_ENV` controls security behavior — independent of `NODE_ENV` which Node/Express/npm use for their own optimizations:
- **`local`** — no `Secure` cookie flag, CORS allows any origin, `DASHBOARD_ORIGIN` not required
- **`dev`** — staging on a real server. Full security (HTTPS cookies, locked CORS), but useful for testing before prod
- **`prod`** — full lockdown, identical to dev

Server refuses to start if `JWT_SECRET` or `DB_ENCRYPTION_SECRET` is missing. When `APP_ENV=dev` or `APP_ENV=prod`, `DASHBOARD_ORIGIN` is also required. Two separate secrets — if one leaks, the other is unaffected.

**New dependency:** `express-rate-limit`, `helmet`.

---

## Deployment (Railway)

### Health check

`GET /health` — unauthenticated, returns:
```json
{ "status": "ok", "connected": true, "uptime": 3600 }
```

This is a read-only status report — it doesn't trigger anything. Baileys already auto-reconnects on network blips using saved auth from `data/auth/`. QR scan is only needed on first-ever setup or if you explicitly unlink the device from your phone. Railway uses this endpoint for its built-in health checks.

### Static dashboard serving

In production (`APP_ENV=dev` or `APP_ENV=prod`), Express serves the built dashboard SPA:
```
app.use('/dashboard', express.static('dashboard/dist'))
app.get('/dashboard/*', (req, res) => res.sendFile('dashboard/dist/index.html'))
```
No security concern — it only serves files from the build output directory. All data access still requires JWT auth via the API routes behind it.

### Volume persistence

Railway containers are ephemeral — filesystem is wiped on every deploy/restart. The `data/` directory (SQLite DB + Baileys auth) must be mounted as a Railway volume to persist across deploys.

### railway.toml

```toml
[build]
builder = "nixpacks"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[[mounts]]
source = "data"
destination = "/app/data"
```

### .railwayignore

```
PLAN.md
PLAN_2.md
MIGRATION_PLAN.md
connection-layer-research.md
.claude/
.nvmrc
```

Excludes documentation and local tooling from the Railway build context.

---

## Final File Tree

```
whatsapp/
  index.ts                          — entrypoint (adapter + dispatcher + routes)
  package.json / tsconfig.json / .nvmrc / .gitignore
  railway.toml                      — Railway deployment config (new)
  .railwayignore                    — excludes non-production files (new)
  core/
    adapter.ts                      — WAAdapter interface (unchanged)
    types.ts                        — Message, Chat, Media, App, Permission
    events.ts                       — EventName, WebhookEnvelope (new)
  adapters/baileys/
    index.ts                        — BaileysAdapter (+ setEventDispatcher)
    store.ts                        — SQLiteStore (+ apps, deliveries tables)
  apps/
    registry.ts                     — app CRUD + subscription matching (new)
    dispatcher.ts                   — webhook delivery + HMAC + retry (new)
    permissions.ts                  — scope filtering + permission checks (new)
    cleanup.ts                      — 30-day delivery log retention (new)
  middleware/
    api-auth.ts                     — Bearer token auth for /api/* (new)
    dashboard-auth.ts               — WhatsApp OTP + JWT session auth (new)
  routes/
    api.ts                          — scoped REST endpoints for apps (new)
    dashboard-api.ts                — admin + debug endpoints for dashboard (new)
  dashboard/src/
    App.tsx                         — Messages, Tasks, Media, Summary, Apps, Logs tabs
    main.tsx / index.css            — unchanged
  types/
    qrcode-terminal.d.ts            — unchanged
  cli/
    reconnect.ts                    — emergency reconnect command (new)
```

New runtime dependencies: `express-rate-limit`, `helmet`. Removes `@anthropic-ai/sdk`.

### OTP sends to connected number

The OTP login endpoint uses `sock.user.id` (available after Baileys connects) to send the code to yourself. No need to store the number separately — Baileys already knows it from the authenticated session.
