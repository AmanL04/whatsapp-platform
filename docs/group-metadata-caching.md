# Group Metadata Caching Plan

## Problem

We call `sock.groupMetadata()` in multiple places without caching:

1. **`syncGroupMemberNames()`** — called on every server connect, fetches metadata for all 29+ groups sequentially (with 200ms delay between each)
2. **`resolveGroupName()`** — called per-message for group messages with unknown names, hits WhatsApp API each time
3. **Baileys internal** — when sending messages to groups, Baileys fetches group participant lists for encryption

Without caching, this causes:
- **Rate limiting risk** — WhatsApp may throttle or ban for excessive group metadata requests
- **Slow startup** — 29 groups × 200ms = ~6 seconds just for group sync
- **Redundant calls** — the same group metadata is fetched multiple times per session

## Baileys' `cachedGroupMetadata` Config

From [Baileys docs](https://baileys.wiki/docs/socket/configuration#cachedgroupmetadata):

```typescript
const sock = makeWASocket({
  cachedGroupMetadata: async (jid) => groupCache.get(jid)
})
```

When provided, Baileys uses this cache instead of calling WhatsApp for group participant lists during message encryption. Without it, every group message send triggers an API call that can cause rate limits and bans.

## Proposed Implementation

### 1. In-memory cache with SQLite persistence

```typescript
// In BaileysAdapter
private groupMetadataCache: Map<string, GroupMetadata> = new Map()
```

**Populated from:**
- `syncGroupMemberNames()` on connect (already fetches all group metadata)
- `groups.upsert` event (new groups)
- `resolveGroupName()` cache misses (fetch once, cache forever)

**Persisted to SQLite** — new `group_metadata` table:
```sql
CREATE TABLE IF NOT EXISTS group_metadata (
  group_jid TEXT PRIMARY KEY,
  subject TEXT,
  participants TEXT,  -- JSON array of { id, jid, lid, admin }
  updated_at INTEGER
);
```

### 2. Wire into Baileys socket config

```typescript
this.sock = makeWASocket({
  version,
  auth: state,
  syncFullHistory: true,
  cachedGroupMetadata: async (jid) => {
    return this.groupMetadataCache.get(jid) ?? null
  },
})
```

### 3. Update `syncGroupMemberNames()`

Currently fetches metadata and discards it after extracting LID→JID mappings. Change to:
- Store full metadata in cache + SQLite
- On startup, load from SQLite first (instant), then refresh from WhatsApp in background
- This makes startup fast AND the cache fresh

### 4. Update `resolveGroupName()`

Currently calls `sock.groupMetadata()` on cache miss. Change to:
- Check in-memory cache first
- Check SQLite second
- Only call WhatsApp API as last resort
- Store result in both cache and SQLite

## Benefits

| Before | After |
|---|---|
| 29 API calls on every connect | 0 API calls (loaded from SQLite), background refresh |
| Per-message API call for unknown groups | In-memory lookup |
| No Baileys encryption cache | Baileys uses our cache for sends |
| Rate limit risk on heavy group usage | Minimal API calls |

## Files Changed

| File | Changes |
|---|---|
| `adapters/baileys/index.ts` | Add cache, wire `cachedGroupMetadata`, update `syncGroupMemberNames` and `resolveGroupName` |
| `adapters/baileys/store.ts` | Add `group_metadata` table, `upsertGroupMetadata`, `getGroupMetadata`, `getAllGroupMetadata` |

## Risk

Low — this is purely additive. The cache is a performance optimization. If the cache returns stale data, Baileys falls back to API calls. Group metadata changes rarely (member joins/leaves, subject changes) and we update on `groups.upsert` events.
