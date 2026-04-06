# Group Metadata Caching

## Problem

Group metadata (subject, participants) is fetched from WhatsApp's API in multiple places without persistent caching:

1. **`syncGroupMemberNames()`** — fetches metadata for all groups to extract LID→phone mappings. Currently only runs on fresh DB (skipped when identities cached), but when it does run, it makes N sequential API calls with 200ms spacing.
2. **`resolveGroupName()`** — called per-message for groups with unknown names. Hits WhatsApp API on every cache miss. The in-memory `chatNames` cache helps within a session, but is lost on restart.
3. **Baileys internal** — when sending messages to groups, Baileys fetches participant lists for Signal encryption. Without `cachedGroupMetadata`, every group send triggers an API call.

### Current state

- `chatNames: Map<string, string>` — in-memory only, lost on restart.
- `identities` table — persists LID→phone mappings. Used to skip full group sync on restart.
- `chats` table — persists group name via `upsertChat()`. No participant data.
- `groupSyncDone` flag + 30s fallback timer + history-sync trigger — hacky timing logic to defer group sync.

### What's missing

- No persistent participant data — on restart, Baileys has no cached participants for encryption.
- No staleness tracking — can't tell if metadata is fresh or stale.
- `resolveGroupName()` hits WhatsApp API on restart for any group not yet seen in the session.
- `syncGroupMemberNames()` fetches everything fresh, ignoring what we already know.

## Approach: Two columns on `chats`, no new table

Group metadata is 1:1 with chats. A separate table adds JOINs and sync headaches. Instead, add two columns to `chats`:

```sql
ALTER TABLE chats ADD COLUMN participants TEXT;             -- JSON: [{ id, jid, lid, admin }], NULL for DMs
ALTER TABLE chats ADD COLUMN group_metadata_updated_at INTEGER;  -- when we last fetched from WhatsApp
```

On fresh DB these are created in `init()`. `getChats()` does not SELECT these columns — zero overhead on the dashboard sidebar. Read only when needed.

### In-memory cache

Replace `chatNames: Map<string, string>` group usage with a richer structure:

```typescript
private groupCache: Map<string, { subject: string; participants: any[] }> = new Map()
```

`chatNames` stays for DM contact names. Group subjects move to `groupCache`.

### Startup flow (replaces current timing logic)

1. **Load from SQLite** — query chats where `is_group = 1 AND participants IS NOT NULL`, populate `groupCache`. Extract LID→phone mappings from stored participants, populate identity cache. Zero API calls.
2. **Background refresh** — after connect, refresh groups where `group_metadata_updated_at` is NULL or older than 24 hours. Batched with 200ms delays. Updates cache + SQLite + identities.
3. **Remove `groupSyncDone` flag, 30s fallback timer, and history-sync trigger** — the SQLite cache makes all of this unnecessary. Fresh DB: all groups stale → all fetched in background. Subsequent runs: instant load, only stale entries refreshed.

### Wire `cachedGroupMetadata` into Baileys

```typescript
this.sock = makeWASocket({
  version,
  auth: state,
  syncFullHistory: true,
  cachedGroupMetadata: async (jid) => {
    const cached = this.groupCache.get(jid)
    if (!cached) return undefined
    return { id: jid, subject: cached.subject, participants: cached.participants } as GroupMetadata
  },
})
```

Prevents Baileys from calling WhatsApp's API for participant lists on every group message send.

### Update event handlers

- **`groups.upsert`** — store subject + participants in `groupCache` + SQLite (currently only stores subject in `chatNames`)
- **`groups.update`** — update subject in cache + SQLite
- **`group-participants.update`** — update participant list in cache + SQLite (not currently handled)

### Simplify `resolveGroupName()`

```typescript
private async resolveGroupName(msg: Message): Promise<void> {
  if (!msg.isGroup || msg.groupName) return
  // 1. In-memory cache
  const cached = this.groupCache.get(msg.chatId)
  if (cached) { msg.groupName = cached.subject; return }
  // 2. SQLite (chats table)
  const stored = this.store.getGroupParticipants(msg.chatId)
  if (stored) { this.groupCache.set(msg.chatId, stored); msg.groupName = stored.subject; return }
  // 3. API (last resort) — fetch, store in cache + SQLite
  if (!this.sock) return
  try {
    const metadata = await this.sock.groupMetadata(msg.chatId)
    this.store.updateGroupMetadata(msg.chatId, metadata.subject, metadata.participants)
    this.groupCache.set(msg.chatId, { subject: metadata.subject, participants: metadata.participants })
    msg.groupName = metadata.subject
  } catch { /* silent */ }
}
```

### Rename `syncGroupMemberNames()` → `refreshStaleGroups()`

Instead of fetching ALL groups on first connect:

1. Query chats where `is_group = 1` and (`group_metadata_updated_at` is NULL or older than 24h)
2. Fetch metadata for stale groups only (with 200ms delay between calls)
3. Update cache + SQLite + identities
4. Safe to run on every connect — only makes API calls for stale entries

## Store changes

### New methods on `SQLiteStore`

- `updateGroupMetadata(groupJid, subject, participants)` — updates `participants` and `group_metadata_updated_at` columns on the chats row
- `getGroupParticipants(groupJid)` — returns `{ subject, participants }` for a single group
- `loadAllGroupMetadata()` — returns all groups with non-null participants for startup cache population
- `getStaleGroups(maxAgeSeconds)` — returns group JIDs where `group_metadata_updated_at` is NULL or older than threshold

### Modified methods

- `upsertChat()` — no change needed (participants/metadata_updated_at are separate updates, not on every message)
- `getChats()` — no change (doesn't SELECT new columns)

## Files changed

| File | Changes |
|---|---|
| `migrations/0001_initial-schema.ts` | Schema includes `participants` and `group_metadata_updated_at` columns on chats |
| `migrations/0002_group-metadata-cache.ts` | Delta migration for existing DBs: adds columns, new indexes, drops redundant index |
| `adapters/baileys/store.ts` | `updateGroupMetadata`, `getGroupParticipants`, `loadAllGroupMetadata`, `getStaleGroups` (no schema in store — lives in migrations) |
| `adapters/baileys/index.ts` | Add `groupCache`, wire `cachedGroupMetadata`, simplify startup (remove `groupSyncDone`/timer), handle `group-participants.update`, rename `syncGroupMemberNames` → `refreshStaleGroups`, simplify `resolveGroupName` |

## Verification

1. `npm run typecheck` passes
2. Fresh DB start: all groups fetched in background, participants + metadata_updated_at persisted
3. Restart: zero WhatsApp API calls for group metadata, instant cache load
4. Send message to group: no `groupMetadata` API call in server logs (Baileys uses cache)
5. `resolveGroupName()`: no API calls for known groups
6. New group joined: `groups.upsert` populates cache + SQLite immediately
7. After 24h: stale groups refreshed in background on next connect
