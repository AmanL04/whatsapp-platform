# Track API-Sent Messages + `sentByYou` in Webhooks

## Problem

When an app sends a message via `POST /api/messages/send`, the message comes back through `messages.upsert` and gets dispatched as a webhook. The receiving app can't distinguish "I sent this" from "the phone user sent this" — risking infinite bot loops.

Additionally, there's no historical record of which messages were sent via the API vs from the phone, or which registered app triggered the send.

## Approach

### 1. New column on `messages` table: `sent_by_app_id`

```sql
ALTER TABLE messages ADD COLUMN sent_by_app_id TEXT;
```

Values:
- `NULL` — sent from phone/Beeper (not via API)
- `"dashboard"` — sent from dashboard UI (future send-message feature)
- `"app_xxx"` — sent by a registered app via the API

No separate table — it's a 1:1 relationship with messages.

### 2. Change `sendMessage` to return the Baileys message ID

Currently:
```typescript
async sendMessage(chatId: string, content: string): Promise<void> {
  await this.sock.sendMessage(chatId, { text: content })
}
```

Change to (must also handle the group retry path):
```typescript
async sendMessage(chatId: string, content: string): Promise<string> {
  if (!this.sock) throw new Error('not connected')
  try {
    const sent = await this.sock.sendMessage(chatId, { text: content })
    return sent?.key?.id ?? ''
  } catch (err) {
    if (chatId.endsWith('@g.us') && this.groupCache.has(chatId)) {
      this.groupCache.delete(chatId)
      const sent = await this.sock.sendMessage(chatId, { text: content })
      // repopulate cache after successful retry...
      return sent?.key?.id ?? ''
    }
    throw err
  }
}
```

`sock.sendMessage()` returns `proto.WebMessageInfo | undefined` — `key.id` is the WhatsApp message ID, same value stored as `messages.id` in DB and received as `raw.key.id` in `messages.upsert`. All three are the same ID.

Note: both the happy path AND the retry path must capture and return the message ID.

### 3. Pre-insert full message row immediately after send (no in-memory map)

In `routes/api.ts` POST /messages/send, after successful send:
```typescript
const messageId = await adapter.sendMessage(resolvedChatId, content)
if (messageId) {
  store.preInsertSentMessage({
    id: messageId,
    chatId: resolvedChatId,
    content,
    sentByAppId: app.id,
    timestamp: Math.floor(Date.now() / 1000),
    isFromMe: true,
    isGroup: resolvedChatId.endsWith('@g.us'),
  })
}
```

This writes a full row to SQLite immediately — no in-memory state that can be lost on restart. The store method:

```typescript
preInsertSentMessage(msg: { id: string; chatId: string; content: string; sentByAppId: string; timestamp: number; isFromMe: boolean; isGroup: boolean }) {
  this.db.prepare(`
    INSERT INTO messages (id, chat_id, content, sent_by_app_id, timestamp, is_from_me, is_group, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'text')
    ON CONFLICT(id) DO UPDATE SET sent_by_app_id = excluded.sent_by_app_id
  `).run(msg.id, msg.chatId, msg.content, msg.sentByAppId, msg.timestamp, msg.isFromMe ? 1 : 0, msg.isGroup ? 1 : 0)
}
```

Uses `ON CONFLICT DO UPDATE SET sent_by_app_id` — if `messages.upsert` fires first (rare race), the row exists but `sent_by_app_id` is NULL. This overwrites it with the correct app ID. If pre-insert runs first (normal case), it creates the full row.

### 4. Preserve `sent_by_app_id` in `upsertMessage`

Currently uses `INSERT OR REPLACE` which would overwrite the pre-inserted `sent_by_app_id` with NULL. Change to `INSERT ... ON CONFLICT DO UPDATE` that preserves it:

```sql
INSERT INTO messages (id, ..., sent_by_app_id)
VALUES (?, ..., NULL)
ON CONFLICT(id) DO UPDATE SET
  chat_id = excluded.chat_id,
  sender_id = excluded.sender_id,
  ...
  sent_by_app_id = COALESCE(messages.sent_by_app_id, excluded.sent_by_app_id)
```

`COALESCE` keeps the existing `sent_by_app_id` if already set (from pre-insert), otherwise uses the new value (NULL for normal messages).

### 5. Attach `sentByYou` in webhook dispatch (NOT `sentByAppId`)

In `messages.upsert` handler, after `upsertMessage`:
```typescript
// Read sent_by_app_id from the stored message
const sentByAppId = this.store.getSentByAppId(msg.id)
if (sentByAppId) {
  msg.sentByAppId = sentByAppId
}
```

In the dispatcher, when building the webhook payload per target app:
```typescript
// Don't expose app IDs to other apps — only tell each app if THEY sent it
payload.sentByYou = (message.sentByAppId === targetApp.id)
```

Webhook payload:
- `sentByYou: true` — "you sent this via the API, ignore it to avoid loops"
- `sentByYou: false` or absent — "someone else sent this"

No app ID leakage between registered apps.

### 6. Add to types

In `core/types.ts`:
```typescript
export interface Message {
  // ... existing fields
  sentByAppId?: string  // internal: which app sent this (NULL = phone, "dashboard" = admin UI)
}
```

`sentByYou` is NOT on the Message type — it's added by the dispatcher at delivery time per target app.

### 7. Dashboard: reserved `"dashboard"` app ID

When the dashboard send endpoint (from `todos/send-message-dashboard.md`) is implemented:
```typescript
const messageId = await adapter.sendMessage(resolvedChatId, content)
if (messageId) {
  store.preInsertSentMessage({ ..., sentByAppId: 'dashboard' })
}
```

### 8. Event handlers affected

Only `messages.upsert` needs the check — that's where live messages trigger webhook dispatch. Other handlers:
- `dispatchHistoryBatch` — old messages, not API-sent. No check needed.
- `messages.reaction` — reactions can't be sent via our API. No check needed.

## Store methods

```typescript
preInsertSentMessage(msg: { id, chatId, content, sentByAppId, timestamp, isFromMe, isGroup })
getSentByAppId(messageId: string): string | null
```

## Migration

`migrations/0004_add-sent-by-app-id.ts`:
```sql
ALTER TABLE messages ADD COLUMN sent_by_app_id TEXT;
```

Also add column to `0001_initial-schema.ts` for fresh DBs.

## WAAdapter interface change

`core/adapter.ts`:
```typescript
sendMessage(chatId: string, content: string): Promise<string>  // was Promise<void>
```

## Dispatcher change

`apps/dispatcher.ts` — when building webhook payload for each target app, add:
```typescript
sentByYou: (message.sentByAppId === targetApp.id)
```

## Files changed

| File | Changes |
|---|---|
| `core/types.ts` | Add `sentByAppId?` to Message |
| `core/adapter.ts` | `sendMessage` returns `Promise<string>` |
| `adapters/baileys/index.ts` | Return message ID from `sendMessage`, read `sentByAppId` in `messages.upsert` |
| `adapters/baileys/store.ts` | `preInsertSentMessage`, `getSentByAppId`, update `upsertMessage` to preserve `sent_by_app_id` via COALESCE |
| `routes/api.ts` | Call `store.preInsertSentMessage` after successful send |
| `apps/dispatcher.ts` | Add `sentByYou` to webhook payload per target app |
| `migrations/0001_initial-schema.ts` | Add `sent_by_app_id` column to messages |
| `migrations/0004_add-sent-by-app-id.ts` | Delta migration for existing DBs |

## Verification

1. `npm run typecheck` passes
2. App sends message via API → message row has `sent_by_app_id = app.id`
3. Server restart before `messages.upsert` → pre-inserted row survives, `sent_by_app_id` intact
4. Webhook to sending app has `sentByYou: true`
5. Webhook to other apps has `sentByYou: false`
6. Message sent from phone → no `sentByYou` in webhook, `sent_by_app_id` is NULL
7. `sqlite3 data/whatsapp.db "SELECT id, content, sent_by_app_id FROM messages WHERE sent_by_app_id IS NOT NULL"` shows API-sent history
