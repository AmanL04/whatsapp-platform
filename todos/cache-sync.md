# Fix In-Memory Cache Synchronization

## Context

Three in-memory caches (`identityCache`, `groupCache`, `chatNames`) have synchronization gaps with the DB. Writes to DB aren't always reflected in cache, cache entries aren't cleaned on remap/delete, and startup loading is incomplete. This causes stale names, missed identity mappings, and inconsistent behavior.

## Issues Found (by severity)

### CRITICAL — Cache-DB desync

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | `contacts.upsert/update` don't normalize JIDs | index.ts:132-153 | LID-format contact IDs cached raw, never resolved |
| 2 | `cascadeNormalize` doesn't clean `chatNames` | index.ts:350-364 | Stale LID entries persist forever after remap |
| 3 | pushName `upsertIdentity` calls missing `updateIdentityCache` | index.ts:577-579 | Identity cache misses for sender JIDs |
| 4 | DM contact names not loaded on startup | index.ts:constructor | chatNames empty for DMs until contacts.upsert fires |
| 5 | `extractIdentitiesFromMappings` writes to LID key in chatNames | index.ts:465 | Perpetuates stale LID entries |

### HIGH — Missing event handlers / cache updates

| # | Issue | Location | Impact |
|---|---|---|---|
| 6 | Missing `groups.update` event handler | index.ts | Group subject changes lost until 24h refresh |
| 7 | `chats.upsert/update` don't update `groupCache` | index.ts:101-123 | cachedGroupMetadata returns stale subject |
| 8 | `sendMessage` retry doesn't repopulate cache | index.ts:327-328 | Group cache empty after eviction, extra API calls |
| 9 | `verifiedBizName` upsertIdentity missing cache update | index.ts:588 | Identity cache miss |
| 10 | `group-participants.update` doesn't update `chatNames` | index.ts:170-177 | chatNames misses group subject from fresh metadata |

## Fixes

### Fix 1: Normalize contact JIDs (`contacts.upsert/update`)

```typescript
const contactId = resolveCanonicalJid(normalizeJid(contact.id))
if (contactId && name) {
  this.chatNames.set(contactId, name)
  if (!contactId.endsWith('@g.us')) {
    this.store.upsertChat(contactId, name, false)
  }
}
```

### Fix 2: Clean chatNames in `cascadeNormalize`

Add after the chat DELETE:
```typescript
this.chatNames.delete(oldJid)
```

### Fix 3: Add missing `updateIdentityCache` calls in `normaliseMessage`

```typescript
// After pushName upsertIdentity (line 577-579):
updateIdentityCache(senderId, senderId)
if (rawSenderId !== senderId) {
  updateIdentityCache(rawSenderId, senderId)
}

// After verifiedBizName upsertIdentity (line 588):
updateIdentityCache(senderId, senderId)
```

### Fix 4: Load DM names on startup

Add to constructor after `loadGroupCacheFromDb()`:
```typescript
private loadChatNamesFromDb() {
  const chats = this.store.getChats({ limit: 1000 })
  for (const chat of chats) {
    if (!this.chatNames.has(chat.id)) {
      this.chatNames.set(chat.id, chat.name)
    }
  }
}
```

### Fix 5: Write to canonical key in `extractIdentitiesFromMappings`

```typescript
// Change line 465:
this.chatNames.set(phoneJid, name)  // canonical, not LID
```

### Fix 6: Add `groups.update` handler

```typescript
this.sock.ev.on('groups.update', (updates) => {
  for (const update of updates) {
    if (!update.id) continue
    if (update.subject) {
      this.chatNames.set(update.id, update.subject)
      this.store.upsertChat(update.id, update.subject, true)
      const cached = this.groupCache.get(update.id)
      if (cached) {
        cached.subject = update.subject
        this.groupCache.set(update.id, cached)
        this.store.updateGroupMetadata(update.id, update.subject, cached.participants)
      }
    }
  }
})
```

### Fix 7: Update `groupCache` in `chats.upsert/update`

For group chats, also update groupCache subject:
```typescript
if (chatId.endsWith('@g.us')) {
  const cached = this.groupCache.get(chatId)
  if (cached) {
    cached.subject = chat.name
    this.groupCache.set(chatId, cached)
  }
}
```

### Fix 8: Repopulate cache after `sendMessage` retry

After successful retry, fetch fresh metadata:
```typescript
this.groupCache.delete(chatId)
await this.sock.sendMessage(chatId, { text: content })
// Repopulate cache with fresh metadata
try {
  const metadata = await this.sock!.groupMetadata(chatId)
  this.groupCache.set(chatId, { subject: metadata.subject, participants: metadata.participants })
  this.store.updateGroupMetadata(chatId, metadata.subject, metadata.participants)
} catch { /* non-critical */ }
```

### Fix 9: Already covered by Fix 3

### Fix 10: Update `chatNames` in `group-participants.update`

Add after metadata fetch:
```typescript
this.chatNames.set(id, metadata.subject)
```

## Files changed

| File | Changes |
|---|---|
| `adapters/baileys/index.ts` | All 10 fixes — contact normalization, cascadeNormalize cleanup, identity cache updates, DM name loading, groups.update handler, groupCache sync, sendMessage repopulation |

## Verification

1. `npm run typecheck` passes
2. Restart server — DM names loaded from DB into chatNames (log count)
3. Receive message from LID contact — identity cache updated, chatNames uses canonical JID
4. Rename a group on phone — `groups.update` handler fires, cache + DB updated
5. Send to group after cache eviction — retries, repopulates cache
6. `cascadeNormalize` runs — old chatNames entry cleaned up
