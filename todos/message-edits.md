# Handle Message Edits

## Problem

WhatsApp supports editing sent messages. Baileys emits these as `messages.update` events with `protocolMessage.editedMessage`. Currently, `normaliseMessage` skips all `protocolMessage` types — edits are silently dropped. The original message stays unchanged in the DB.

## Current behavior

```typescript
// adapters/baileys/index.ts — normaliseMessage
if (msg.protocolMessage || msg.senderKeyDistributionMessage || msg.reactionMessage) {
  return null  // ← edits discarded here
}
```

## Proposed changes

### 1. Detect edits in `messages.update` or `messages.upsert`

Baileys may emit edits via either event. The edit payload looks like:

```typescript
raw.message.protocolMessage.editedMessage  // the new content
raw.message.protocolMessage.key            // the original message's key (id + chatId)
raw.message.protocolMessage.type === 14    // EDIT protocol message type
```

### 2. Update message content in DB

When an edit is detected:
- Extract the original message ID from `protocolMessage.key.id`
- Extract the new content from `protocolMessage.editedMessage`
- Update the `content` column in the messages table
- Optionally add `edited_at INTEGER` column to track when it was edited
- Optionally add `original_content TEXT` column to preserve history

### 3. New store method

```typescript
editMessage(messageId: string, newContent: string): boolean {
  const result = this.db.prepare(
    'UPDATE messages SET content = ?, edited_at = ? WHERE id = ?'
  ).run(newContent, Math.floor(Date.now() / 1000), messageId)
  return result.changes > 0
}
```

### 4. Webhook event

Add `'message.edited'` to `EventName`. Dispatch with payload:

```json
{
  "event": "message.edited",
  "payload": {
    "messageId": "original_message_id",
    "chatId": "...",
    "senderId": "...",
    "oldContent": "...",
    "newContent": "...",
    "editedAt": "ISO 8601"
  }
}
```

### 5. Dashboard UI

Messages with `edited_at` could show a small "(edited)" label. Low priority.

## Migration

- `migrations/0005_add-edited-at.ts` — adds `edited_at INTEGER` column to messages
- Also add to `0001_initial-schema.ts` for fresh DBs

## Files changed

| File | Changes |
|---|---|
| `adapters/baileys/index.ts` | Detect `protocolMessage.editedMessage`, extract edit, call `store.editMessage`, dispatch `message.edited` webhook |
| `adapters/baileys/store.ts` | `editMessage()` method |
| `core/types.ts` | Add `editedAt?` to Message |
| `core/events.ts` | Add `'message.edited'` to EventName |
| `migrations/0001_initial-schema.ts` | Add `edited_at` column |
| `migrations/0005_add-edited-at.ts` | Delta for existing DBs |

## Complexity

Low-medium. Main challenge is understanding the exact Baileys event structure for edits — needs testing with a real edit to confirm the payload shape.
