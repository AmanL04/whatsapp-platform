# API Reference Documentation

## Problem

The README lists endpoints as one-liners with no request/response details. External app developers have no documentation for query params, request bodies, response shapes, or error codes. A comprehensive `docs/api-reference.md` is needed.

## Scope

Document all endpoints with: method, path, auth, params, request body, response shape, and error responses.

## Scoped API (`/api/*`)

Auth: `Authorization: Bearer <api_key>`. Rate limited (100 req/min per app). Responses filtered to app's scope.

### GET /api/chats

- **Permission:** `chats.read`
- **Query:** `limit` (number, default 20), `after` (ISO 8601), `before` (ISO 8601)
- **Response:** `{ data: Chat[], cursors: { next, previous } }`
- **Chat shape:** `{ id, name, isGroup, lastMessageAt, unreadCount }`

### GET /api/messages

- **Permission:** `messages.read`
- **Query:** `chatId` (string, resolved via `resolveCanonicalJid`), `limit`, `after`, `before`
- **Response:** `{ data: Message[], cursors: { next, previous } }`
- **Message shape:** `{ id, chatId, senderId, senderName, content, type, mimeType?, timestamp, isFromMe, isGroup, groupName?, replyTo?, reactions?: Reaction[] }`
- **Reaction shape:** `{ messageId, senderId, senderName, emoji, timestamp }`
- **403:** chatId outside app's scope

### GET /api/media

- **Permission:** `media.read`
- **Query:** `type` (string), `sender` (string), `source` ('chat' | 'story'), `limit`, `after`, `before`
- **Response:** `{ data: Message[], cursors: { next, previous } }` (messages where type != 'text')

### GET /api/media/:id/download

- **Permission:** `media.download`
- **Path:** `id` — message ID of the media message
- **Response:** Binary stream with `Content-Type: application/octet-stream`

### POST /api/messages/send

- **Permission:** `messages.send`
- **Body:** `{ chatId: string, content: string }` — chatId normalized via `resolveCanonicalJid`
- **Response:** `{ ok: true }`
- **400:** missing chatId or content
- **403:** chatId outside app's scope

## Dashboard API (`/dashboard/*`)

Auth: JWT cookie `wa_session` (set via OTP login). No scope restrictions — dashboard user owns the WhatsApp account.

### Auth (public, no JWT required)

| Endpoint | Method | Body | Response |
|---|---|---|---|
| `/dashboard/auth/send-otp` | POST | — | `{ ok, message }`. Rate limited. 503 if WhatsApp disconnected. |
| `/dashboard/auth/verify-otp` | POST | `{ code }` | `{ ok }` + sets `wa_session` cookie. 401 on wrong code (shows `attemptsRemaining`). |
| `/dashboard/api/auth/check` | GET | — | `{ authenticated: boolean }` |

### Apps CRUD

| Endpoint | Method | Body | Response |
|---|---|---|---|
| `/dashboard/api/apps` | GET | — | `App[]` (secrets masked to first 8 chars + '...') |
| `/dashboard/api/apps` | POST | `RegisterAppInput` | `App` (full secrets shown on creation only) |
| `/dashboard/api/apps/:id` | GET | — | `App` (secrets masked) |
| `/dashboard/api/apps/:id` | PUT | Partial app fields | `{ ok }` |
| `/dashboard/api/apps/:id` | DELETE | — | `{ ok }` (soft delete — sets active=0) |
| `.../apps/:id/regenerate-key` | POST | — | `{ apiKey }` (new full key) |
| `.../apps/:id/regenerate-secret` | POST | — | `{ webhookSecret }` (new full secret) |

**RegisterAppInput:** `{ name, description?, webhookGlobalUrl?, webhookEvents?: [{ name, url? }], permissions, scopeChatTypes, scopeSpecificChats? }`

### Data (same as scoped API but no scope filtering)

| Endpoint | Query params |
|---|---|
| `GET /dashboard/api/chats` | limit, after, before |
| `GET /dashboard/api/messages` | chatId, limit, after, before |
| `GET /dashboard/api/media` | type, sender, source, limit, after, before |
| `GET /dashboard/api/stats` | — (returns `{ messages, chats, media, apps, deliveries }`) |

### Deliveries

| Endpoint | Query params |
|---|---|
| `GET /dashboard/api/deliveries` | limit, appId, status, after, before |
| `GET /dashboard/api/apps/:id/deliveries` | limit, after, before |

**Delivery shape:** `{ id, app_id, event, payload, status, attempts, last_attempt_at, response_status, created_at }`

## Health / Utility

| Endpoint | Auth | Response |
|---|---|---|
| `GET /health` | None | `{ status: "ok", connected: boolean, uptime: number }` |
| `POST /test/webhook` | None (local only) | `{ received: true }` — logs webhook payloads to console |

## Common patterns

- **Cursor pagination:** `?before=<ISO timestamp>` for older, `?after=<ISO timestamp>` for newer. Max limit: 100.
- **Response wrapping:** Scoped API uses `{ data, cursors }`. Dashboard API returns arrays directly.
- **Errors:** `{ error: "string" }` with HTTP status (400, 401, 403, 500, 503).
- **JID normalization:** chatId inputs are resolved via `resolveCanonicalJid` (handles LIDs, device suffixes).

## Files to create

| File | Content |
|---|---|
| `docs/api-reference.md` | Full API reference based on this plan |

## Complexity

Low — documentation only, no code changes.
