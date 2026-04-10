# API Reference

## Authentication

### External App API (`/api/*`)

```
Authorization: Bearer <apiKey>
```

API key issued on app registration. Rate limited: 100 requests/minute per app.

### Dashboard API (`/dashboard/api/*`)

JWT stored in `wa_session` HTTP-only cookie. Set via OTP login flow. Expires in 1 hour.

Auth endpoints (`/dashboard/auth/*`) are public — no cookie required.

---

## External App API

All responses are scope-filtered to the app's `scopeChatTypes` and `scopeSpecificChats`.

### GET /api/chats

List chats visible to this app.

**Permission:** `chats.read`

| Query param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 20 | Max results (capped at 100) |
| `before` | ISO 8601 | — | Cursor: chats older than this |
| `after` | ISO 8601 | — | Cursor: chats newer than this |

**Response:**
```json
{
  "data": [
    {
      "id": "919986273519@s.whatsapp.net",
      "name": "Aman Lodha",
      "isGroup": false,
      "lastMessageAt": "2026-04-06T12:30:00.000Z",
      "unreadCount": 3
    }
  ],
  "cursors": {
    "next": "2026-04-06T12:30:00.000Z",
    "previous": null
  }
}
```

### GET /api/messages

Get messages, optionally filtered by chat.

**Permission:** `messages.read`

| Query param | Type | Default | Description |
|---|---|---|---|
| `chatId` | string | — | Filter by chat JID (normalized internally) |
| `limit` | number | 20 | Max results (capped at 100) |
| `before` | ISO 8601 | — | Messages older than this |
| `after` | ISO 8601 | — | Messages newer than this |

**Response:**
```json
{
  "data": [
    {
      "id": "A5808E945D659F14",
      "chatId": "120363410346002725@g.us",
      "senderId": "919986273519@s.whatsapp.net",
      "senderName": "Aman Lodha",
      "content": "Hello",
      "type": "text",
      "timestamp": "2026-04-06T12:30:00.000Z",
      "isFromMe": false,
      "isGroup": true,
      "groupName": "OTT ka OTP",
      "reactions": [
        {
          "messageId": "A5808E945D659F14",
          "senderId": "918135946668@s.whatsapp.net",
          "senderName": "Laveena",
          "emoji": "👍",
          "timestamp": "2026-04-06T12:31:00.000Z"
        }
      ]
    }
  ],
  "cursors": { "next": "...", "previous": null }
}
```

**Errors:**
- `403` — `chatId` outside app's scope

### GET /api/media

Get media messages (type != text).

**Permission:** `media.read`

| Query param | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Filter: `image`, `video`, `audio`, `document`, `sticker` |
| `sender` | string | — | Filter by sender name (partial match) |
| `source` | string | — | `chat` or `story` |
| `limit` | number | 20 | Max results (capped at 100) |
| `before` | ISO 8601 | — | Older than this |
| `after` | ISO 8601 | — | Newer than this |

**Response:** Same shape as `/api/messages` but only media types.

### GET /api/media/:id/download

Download a media file by message ID.

**Permission:** `media.download`

**Response:** Binary stream with `Content-Type: application/octet-stream`

### POST /api/messages/send

Send a text message.

**Permission:** `messages.send`

**Body:**
```json
{
  "chatId": "919986273519@s.whatsapp.net",
  "content": "Hello from my app"
}
```

**Response:**
```json
{
  "ok": true,
  "messageId": "A5518EA7742385038AC9"
}
```

**Errors:**
- `400` — missing `chatId` or `content`
- `403` — chat outside app's scope
- `500` — WhatsApp send failure (logged with stack trace)

**Behavior:** `chatId` is normalized via `resolveCanonicalJid`. Message is pre-inserted in DB with `sent_by_app_id` for tracking. Webhook to this app will include `sentByYou: true`.

---

## Dashboard Auth

### POST /dashboard/auth/send-otp

Send a 6-digit OTP to the connected WhatsApp number. No auth required.

**Response:** `{ "ok": true, "message": "OTP sent to your WhatsApp" }`

**Errors:**
- `429` — max 3 requests per 5 minutes
- `503` — WhatsApp not connected

### POST /dashboard/auth/verify-otp

Verify OTP and get a session cookie. No auth required.

**Body:** `{ "code": "123456" }`

**Response:** `{ "ok": true }` + sets `wa_session` cookie (1-hour JWT)

**Errors:**
- `400` — missing code, no OTP pending, OTP expired
- `401` — wrong code (includes `attemptsRemaining`)
- `429` — max 5 attempts per OTP

### GET /dashboard/api/auth/check

Check if the current session is valid. No auth required.

**Response:** `{ "authenticated": true }` or `{ "authenticated": false }`

---

## Dashboard Admin API

All endpoints below require a valid `wa_session` cookie. Returns `401` if not authenticated.

### Apps

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/api/apps` | List all active apps (secrets masked) |
| POST | `/dashboard/api/apps` | Register a new app (full secrets in response) |
| GET | `/dashboard/api/apps/:id` | Get app details (secrets masked) |
| PUT | `/dashboard/api/apps/:id` | Update app (partial fields) |
| DELETE | `/dashboard/api/apps/:id` | Deactivate app (soft delete) |
| POST | `/dashboard/api/apps/:id/regenerate-key` | Generate new API key |
| POST | `/dashboard/api/apps/:id/regenerate-secret` | Generate new webhook secret |

**Register app body:**
```json
{
  "name": "My Bot",
  "description": "Automated replies",
  "webhookGlobalUrl": "https://mybot.example.com/webhook",
  "webhookEvents": [
    { "name": "message.received" },
    { "name": "message.reaction", "url": "https://mybot.example.com/reactions" }
  ],
  "permissions": ["messages.read", "messages.send"],
  "scopeChatTypes": ["dm", "group"],
  "scopeSpecificChats": []
}
```

**Secrets:** Full API key and webhook secret are shown only on creation and regeneration. All other endpoints mask them (first 8 chars + `...`).

### Data (admin view, no scope filtering)

| Method | Path | Query params |
|---|---|---|
| GET | `/dashboard/api/chats` | `limit`, `before`, `after` |
| GET | `/dashboard/api/messages` | `chatId`, `limit`, `before`, `after` |
| GET | `/dashboard/api/media` | `type`, `sender`, `source`, `limit`, `before`, `after` |
| GET | `/dashboard/api/stats` | — |

Response shapes match the external API but without scope filtering. Dashboard messages include `sentByAppId` field (visible to admin only).

**Stats response:**
```json
{
  "messages": 12500,
  "chats": 375,
  "media": 890,
  "apps": 3,
  "deliveries": 4200
}
```

### Deliveries

| Method | Path | Query params |
|---|---|---|
| GET | `/dashboard/api/deliveries` | `limit`, `appId`, `status`, `before`, `after` |
| GET | `/dashboard/api/apps/:id/deliveries` | `limit`, `before`, `after` |

**Delivery shape:**
```json
{
  "id": "a1b2c3...",
  "app_id": "app_97f498de",
  "event": "message.received",
  "payload": "{\"event\":\"message.received\",...}",
  "status": "delivered",
  "attempts": 1,
  "last_attempt_at": 1712400000,
  "response_status": 200,
  "created_at": 1712400000
}
```

Status values: `pending`, `delivered`, `retrying`, `failed`

---

## Health

### GET /health

No auth required.

```json
{
  "status": "ok",
  "connected": true,
  "uptime": 3600
}
```

### POST /test/webhook

Local only (`APP_ENV=local`). Logs received webhook payloads. Returns `{ "received": true }`.

---

## Webhook Delivery

When an event matches an app's subscriptions and scope, the server POSTs to the app's webhook URL.

### Envelope

```json
{
  "event": "message.received",
  "appId": "app_97f498de",
  "timestamp": "2026-04-06T12:30:00.814Z",
  "payload": { ... }
}
```

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | `sha256=<hmac hex digest>` |
| `X-Webhook-Event` | Event name |
| `X-App-Id` | App ID |

### Signature verification

```
expected = 'sha256=' + HMAC-SHA256(raw_body, webhookSecret)
if (request.headers['x-webhook-signature'] !== expected) reject
```

### Events

| Event | When | Payload |
|---|---|---|
| `message.received` | Message from someone else | Message object |
| `message.sent` | Message from the account owner | Message object + `sentByYou` boolean |
| `media.received` | Media message received | Message object (type != text) |
| `message.reaction` | Emoji reaction added/removed | `{ messageId, chatId, senderId, senderName, emoji, action }` |
| `message.edited` | Message content was edited | `{ messageId, chatId, senderId, senderName, oldContent, newContent, editedAt }` |
| `chat.updated` | Chat metadata changed | `{ id, name }` |

### `sentByYou` field

Present on all `message.sent` webhooks. Not present on `message.received` (always someone else's message).

- `sentByYou: true` — this app sent it via the API
- `sentByYou: false` — sent from phone or by a different app via the API

**Use this to prevent bot loops:**
```javascript
if (payload.sentByYou) return // ignore my own API-sent messages
```

### Retry policy

3 attempts with exponential backoff: 1s, 5s, 30s. After 3 failures, marked as `failed`. Stuck deliveries from crashes are re-queued on server restart.

---

## Common Patterns

### Cursor pagination

Pass `before` or `after` as ISO 8601 timestamps. The response includes `cursors.next` and `cursors.previous` for the external API. Dashboard API returns arrays directly (no cursor wrapper).

```
GET /api/messages?chatId=...&limit=50
→ cursors.next = "2026-04-06T10:00:00.000Z"

GET /api/messages?chatId=...&limit=50&before=2026-04-06T10:00:00.000Z
→ next page
```

### JID format

WhatsApp JIDs follow these patterns:
- DM: `919986273519@s.whatsapp.net`
- Group: `120363410346002725@g.us`
- Status: `status@broadcast`

All JID inputs are normalized internally — device suffixes (`:48`) and LIDs are resolved to canonical phone JIDs.

### Error format

All errors return:
```json
{
  "error": "Human-readable error message"
}
```

Some include additional fields (e.g., `attemptsRemaining` on OTP failure).
