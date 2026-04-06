# Mention Tags in Messages

## Problem

WhatsApp mentions (e.g. tagging `@Aman` in a group) appear as raw numbers in our stored content — `@155585324531963` or `@919986273519`. They're not recognized as references to people, not clickable, and not resolved to display names.

The actual mention metadata exists in the raw message at `extendedTextMessage.contextInfo.mentionedJid` — an array of JIDs that were tagged. We store this in `raw_json` but never extract it.

## Current behavior

- Content stored as plain text: `"Hey @919986273519 check this out"`
- No mention metadata extracted from `contextInfo`
- Dashboard renders the raw number as-is

## Proposed changes

### 1. Extract mentions in `normaliseMessage()`

```typescript
// In normaliseMessage, after extracting content:
const mentionedJids: string[] = msg.extendedTextMessage?.contextInfo?.mentionedJid ?? []
const mentions = mentionedJids.map(jid => {
  const canonical = resolveCanonicalJid(normalizeJid(jid))
  return {
    jid: canonical,
    name: this.store.resolveDisplayName(canonical) || this.chatNames.get(canonical) || jid.replace('@s.whatsapp.net', ''),
  }
})
```

### 2. Add to Message type (`core/types.ts`)

```typescript
export interface Message {
  // ... existing fields
  mentions?: { jid: string; name: string }[]
}
```

### 3. Store in DB

Option A: JSON column on messages table (new `mentions TEXT` column, migration needed).

Option B: Don't store — re-extract from `raw_json` on read. Avoids schema change but adds parsing cost per query.

**Recommendation: Option A** — small JSON, written once at insert time, no read-time overhead.

### 4. Dashboard rendering

Replace `@number` patterns in message text with styled name chips:

```tsx
function MentionText({ content, mentions }: { content: string; mentions?: Mention[] }) {
  if (!mentions?.length) return <Linkify text={content} />

  // Build a map: @number → display name
  const mentionMap = new Map(mentions.map(m => [
    m.jid.replace('@s.whatsapp.net', ''),
    m.name,
  ]))

  // Replace @number with styled spans
  // Split on @(\d+) pattern, match against mentionMap
}
```

Styled as bold inline text with a subtle background (similar to WhatsApp's blue mention style).

### 5. Name self-healing

Mentions use `resolveDisplayName` at write time. If the contact's name isn't known yet (LID without mapping), the mention stores the phone number. As identities accumulate, the stored name stays stale.

Options:
- Accept stale names (simple, phone number is still useful)
- Resolve at read time from identities table (accurate but adds a JOIN)
- Cascade update mentions when identity names change (complex, not worth it)

**Recommendation: Resolve at read time** — the `mentions` column stores JIDs, the dashboard resolves names from the identities table. Same pattern as `resolved_sender_name` in message queries.

### 6. API + Webhook exposure

Mentions flow through automatically since all routes return `Message[]`:

- **`GET /api/messages`** — `mentions` array included in each message object
- **`GET /api/media`** — same (media messages can have captions with mentions)
- **Webhook payloads** (`message.received`, `message.sent`) — `mentions` included in the payload since the dispatcher serializes the full `Message` object

No route changes needed — adding `mentions` to the `Message` type is sufficient. External apps can use this to build features like mention notifications, mention-based routing, or tagging analytics.

## Files changed

| File | Changes |
|---|---|
| `core/types.ts` | Add `mentions?` field to Message |
| `migrations/0003_add-mentions-column.ts` | Add `mentions TEXT` column to messages |
| `adapters/baileys/index.ts` | Extract `contextInfo.mentionedJid` in `normaliseMessage()` |
| `adapters/baileys/store.ts` | Store mentions JSON in `upsertMessage()`, include in message queries |
| `dashboard/src/App.tsx` | `MentionText` component replacing `@number` with styled names |

## Complexity

Low-medium. Mostly plumbing — the data is already in `raw_json`, we just need to extract and display it.
