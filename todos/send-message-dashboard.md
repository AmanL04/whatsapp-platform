# Send Message from Dashboard

## Problem

The dashboard Messages tab is read-only. There's no way to send a message from the UI. The only way to send is via the external app API (`POST /api/messages/send`), which requires an API key and app registration — not suitable for quick manual replies from the dashboard.

## Current state

- `adapter.sendMessage(chatId, content)` exists and works (used by the API route and OTP sending)
- `POST /api/messages/send` exists but requires API key auth + app permissions — dashboard uses JWT auth instead
- Dashboard API (`routes/dashboard-api.ts`) has no send endpoint
- Dashboard UI has no message input

## Proposed changes

### 1. Backend: add dashboard send endpoint

In `routes/dashboard-api.ts`:

```typescript
router.post('/messages/send', async (req, res) => {
  const { chatId, content } = req.body
  if (!chatId || !content) {
    return res.status(400).json({ error: 'Missing chatId or content' })
  }
  try {
    await adapter.sendMessage(chatId, content)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' })
  }
})
```

No scope/permission checks needed — the dashboard user is the WhatsApp account owner. They can send to any chat.

### 2. Frontend: message input bar

Add a fixed input bar at the bottom of the message area (only visible when a chat is selected):

```tsx
<div className="px-6 py-3 border-t-2 border-[var(--border)] bg-[var(--bg-surface)] flex items-center gap-3">
  <input value={draft} onChange={...} placeholder="Type a message..."
    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} />
  <button onClick={send}>Send</button>
</div>
```

Behavior:
- Enter to send (Shift+Enter for newline if we use textarea later)
- Input clears after send
- Optimistic: append message to local state immediately, refetch in background
- Disable input + show sending state while request is in flight
- Error: show inline error, restore draft text

### 3. Auto-refresh after send

After a successful send, the message should appear in the chat. Two options:

**Option A: Optimistic update** — construct a local Message object and prepend it to the list. The server will also process it via `messages.upsert` and store it. Next refetch will include it.

**Option B: Refetch** — after send, wait 500ms (for the server to process the message.upsert event), then refetch messages for the current chat.

**Recommendation: Option B** — simpler, avoids constructing a fake message with unknown ID/timestamp. The 500ms delay is acceptable for a debug/admin tool.

### 4. Media sending (future)

Out of scope for this plan. Text-only for now. Media sending would require file upload UI + `adapter.sendMessage` with media payloads — significantly more complex.

## Files changed

| File | Changes |
|---|---|
| `routes/dashboard-api.ts` | Add `POST /messages/send` endpoint |
| `dashboard/src/App.tsx` | Message input bar at bottom of chat, send logic with refetch |

## Complexity

Low. One new endpoint (5 lines), one input bar + send handler in the dashboard.

## Security considerations

- Dashboard auth (JWT) already protects all `/dashboard/api/*` routes
- Rate limiting already applies to dashboard routes
- No scope restriction needed — dashboard user owns the WhatsApp account
- Content is plain text only (no HTML injection risk — WhatsApp strips it anyway)
