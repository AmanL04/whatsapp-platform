# Identity Resolution — Naming & Consolidation Issues

## The Problem

The same person can appear under 5+ different identifiers in our system. Messages, chats, and API responses are fragmented — the same conversation appears as multiple entries, names are missing or inconsistent, and querying by one ID misses messages stored under another.

---

## Raw Data from Every Source

### 1. Live DM message (received while server running)
```json
{
  "key.remoteJid": "234569823420440@lid",     // LID format — NOT the phone number
  "key.fromMe": true,
  "key.id": "A5F398764241A2F4B5A97CAB03B30F32",
  "key.participant": undefined,                // undefined for DMs
  "participant": undefined,                    // undefined for live DMs
  "pushName": "Aman Lodha",                   // ✅ AVAILABLE — profile name
  "verifiedBizName": "Aman Lodha",            // set for business accounts
  "messageTimestamp": 1775449151,              // unix seconds
  "message_keys": ["conversation"]
}
```
**What we get:** pushName ✅, LID as remoteJid, no phone JID in the message itself.

### 2. History sync DM (from initial device pairing)
```json
{
  "key.remoteJid": "918135946668@s.whatsapp.net",  // Phone JID ✅
  "key.fromMe": false,
  "key.id": "4A7883B0666E30BBB58E",
  "key.participant": undefined,                      // always undefined in history
  "participant": undefined,                          // always undefined in history DMs
  "pushName": undefined,                             // ❌ NEVER available in history
  "verifiedBizName": undefined,
  "messageTimestamp": "1775392377",                  // string, not number (Baileys quirk)
  "message_keys": ["extendedTextMessage", "messageContextInfo"]
}
```
**What we get:** Phone JID ✅, but NO name data at all.

### 3. Live group message
```json
{
  "key.remoteJid": "120363378550624371@g.us",       // Group JID
  "key.fromMe": false,
  "key.id": "A5DB6E7E211C9C32A2DE4721D7D8D830",
  "key.participant": "256040230715399@lid",          // ✅ Sender LID — in key.participant
  "participant": undefined,
  "pushName": "Aman Lodha",                          // ✅ AVAILABLE
  "messageTimestamp": 1775449215,
  "message_keys": ["conversation", "messageContextInfo"]
}
```
**What we get:** Group JID, sender LID (in `key.participant`), pushName ✅.

### 4. History sync group message
```json
{
  "key.remoteJid": "918527657878-1571075145@g.us",  // Group JID
  "key.fromMe": false,
  "key.id": "3EB079A2DBB14C54966632",
  "key.participant": undefined,                      // ❌ NOT in key.participant
  "participant": "65678757351541@lid",               // ✅ In raw.participant instead
  "pushName": undefined,                             // ❌ NEVER available
  "messageTimestamp": "1775428862",
  "message_keys": ["conversation", "messageContextInfo"]
}
```
**What we get:** Group JID, sender LID (in `raw.participant`, NOT `key.participant`), NO name.

### 5. Status/story message (with sender)
```json
{
  "key.remoteJid": "status@broadcast",
  "key.fromMe": false,
  "key.id": "AC4E0E6460D3CC97D9AC787A6147BB6A",
  "key.participant": "212540869083330@lid",           // ✅ Sender LID — live status only
  "pushName": "Dinesh Kalbhi",                        // ✅ AVAILABLE — live status only
  "messageTimestamp": 1775445209,
  "message_keys": ["imageMessage", "messageContextInfo"]
}
```
**What we get:** Sender LID + pushName — but ONLY for statuses received while server is running.

### 6. Status/story message (history sync — NO sender)
```json
{
  "key.remoteJid": "status@broadcast",
  "key.fromMe": false,
  "key.id": "ACDE43C0244B12DE7F2B55DF72169C19",
  "key.participant": undefined,                       // ❌ Missing
  "participant": undefined,                           // ❌ Also missing — completely anonymous
  "pushName": undefined,                              // ❌ Missing
  "messageTimestamp": "1775410684",
  "message_keys": ["extendedTextMessage", "messageContextInfo"]
}
```
**What we get:** NOTHING — no sender ID, no name, no way to attribute. These are permanently anonymous.

### 7. Own sent message
```json
{
  "key.remoteJid": "234569823420440@lid",            // Recipient's LID
  "key.fromMe": true,
  "key.id": "A5F398764241A2F4B5A97CAB03B30F32",
  "key.participant": undefined,
  "pushName": "Aman Lodha",                          // YOUR name
  "verifiedBizName": "Aman Lodha",
  "messageTimestamp": 1775449151
}
```
**What we get:** Recipient LID (not phone), your own pushName.

### 8. Device-specific JID (in raw_json)
```json
{
  "key.remoteJid": "919986273519:48@s.whatsapp.net", // Device suffix :48
  "key.fromMe": true
}
```
**What we get:** Phone JID with device suffix. Needs normalization (strip `:48`).

---

## Data from Baileys Events (not in messages)

### contacts.upsert event
```json
{
  "id": "212540869083330@lid",
  "notify": "Dinesh Kalbhi",     // WhatsApp profile name — sometimes populated
  "verifiedName": undefined,      // Only for business accounts
  "name": undefined               // Almost always empty
}
```
**Reality:** Most contacts arrive with ALL name fields empty. Only a handful have `notify`.

### groupMetadata() API response — participants
```json
{
  "id": "88119927947492@lid",
  "jid": "919427748273@s.whatsapp.net",
  "lid": "88119927947492@lid",
  "admin": null
}
```
**Available:** LID ↔ phone JID mapping ✅
**NOT available:** name, pushName, notify — NO NAME DATA from group metadata.

### lid-mapping.update event (Baileys)
Not yet implemented in our code. Provides direct LID↔PN mappings on device sync.

---

## Current Database State — Duplicate Patterns

### chats table (the sidebar source)
```
id                                  | name          | is_group
------------------------------------|---------------|--------
123055108059233@lid                 | Aman Moulders | 0        ← LID with pushName
919035981332@s.whatsapp.net         |               | 0        ← Phone JID, empty name
256040230715399@lid                 | Aman Lodha    | 0        ← Your own LID
919986273519@s.whatsapp.net         |               | 0        ← Your own phone JID
status@broadcast                    | Stories       | 0
```
**Same person appears twice** — once under LID (with name), once under phone JID (no name).

### jid_map table
```
lid                        | phone_jid                        | display_name
---------------------------|----------------------------------|-----------
248430253346905@lid        | 917597473767@s.whatsapp.net      | 917597473767   ← phone fallback
256040230715399@lid        | 256040230715399@lid              | Aman Lodha     ← self-mapped (no phone known)
212540869083330@lid        | 212540869083330@lid              | Dinesh Kalbhi  ← self-mapped
88119927947492@lid         | 919427748273@s.whatsapp.net      | 919427748273   ← phone fallback
```
**Two kinds of entries:**
- `phone_jid != lid` — we know the phone number (from group metadata)
- `phone_jid == lid` — we DON'T know the phone number (DM-only contacts not in any group)

---

## WhatsApp's ID Formats

| Format | Example | When Used | Stable? |
|---|---|---|---|
| **Phone JID** | `919986273519@s.whatsapp.net` | DM chats, contacts | Yes — canonical |
| **Device JID** | `919986273519:48@s.whatsapp.net` | Linked device messages | No — `:48` changes per device |
| **LID** | `256040230715399@lid` | Group members, new DMs, multi-device | Semi — unique per user but separate from phone |
| **Bare phone** | `919986273519` | Our fallback from group sync | No — our own creation |
| **Group JID** | `918527657878-1571075145@g.us` | Group chats | Yes |
| **Status** | `status@broadcast` | Stories/status updates | Yes — shared channel |

### The Core Issue

WhatsApp is migrating from **phone-based IDs** (`@s.whatsapp.net`) to **LID-based IDs** (`@lid`) for multi-device support. During this transition, the same person has BOTH formats. Baileys receives whichever format WhatsApp sends for that context — there's no consistency guarantee.

---

## Current State of Each ID in Our System

### Where IDs get stored

| DB Column | What's stored | Problem |
|---|---|---|
| `messages.chat_id` | Phone JID for DMs, Group JID for groups, `status@broadcast` for stories | Some DMs stored under LID instead of phone JID |
| `messages.sender_id` | LID (from history sync), Phone JID (from some live msgs), Group JID (fallback for unfixed history) | Same person has different sender_id across messages |
| `chats.id` | Mix of Phone JID, LID, bare phone, device JID | Duplicate entries for same person |
| `jid_map.lid` | LID | Only populated from group metadata — misses DM-only contacts |
| `jid_map.phone_jid` | Phone JID or LID (when no mapping exists) | Incomplete — many LIDs map to themselves |

### Example: "Aman Moulders" (one person, multiple entries)

| Location | ID | Name |
|---|---|---|
| `chats` table | `123055108059233@lid` | "Aman Moulders" (from pushName) |
| `chats` table | `919035981332@s.whatsapp.net` | "" (empty) |
| `messages.sender_id` | `123055108059233@lid` | "Aman Moulders" (on messages where pushName arrived) |
| `messages.chat_id` | `919035981332@s.whatsapp.net` | — |
| `jid_map` | No entry | — (LID not in any group metadata) |

**Result:** Sidebar shows two entries. Messages are split. Phone JID entry has no name.

---

## Name Sources — What's Available

### 1. Contact name saved on your phone
- **Available to Baileys?** NO
- WhatsApp does not share your phone's address book with linked devices
- This is why Beeper shows "Papdi Chat" but we can't — Beeper's bridge syncs contacts from the phone directly
- **No fix possible** via Baileys or any linked device approach

### 2. WhatsApp profile name (pushName)
- **Available to Baileys?** YES — but only on live messages
- `raw.pushName` is set when someone sends a message while the server is running
- Not available in history sync — history messages have `pushName: undefined`
- Self-heals over time as people message you
- **This is our primary name source**

### 3. WhatsApp Business verified name
- **Available to Baileys?** YES — as `raw.verifiedBizName`
- Only set for business accounts (INDmoney, PolicyBazaar, Tata Motors etc.)
- Available in some history sync messages
- **Should be used as fallback**

### 4. Contact notify name (from WhatsApp servers)
- **Available to Baileys?** PARTIALLY — via `contacts.upsert` event
- Baileys fires `contacts.upsert` with `{ id, notify, verifiedName, name }` fields
- `notify` = the person's WhatsApp profile name (same as pushName)
- `name` = rarely populated (WhatsApp server-side name, often empty)
- Fires on initial sync but many entries have empty names
- **Already used** — stored in chatNames cache and chats table

### 5. Group metadata participant name
- **Available to Baileys?** NO — group metadata only gives `{ id, jid, lid, admin }`
- No `name` field on participants
- **Only gives us the LID↔phone JID mapping**, not names

### 6. Phone number
- **Available to Baileys?** YES — from group metadata `jid` field
- Always available as last resort
- Format: `919986273519` (extracted from `919986273519@s.whatsapp.net`)
- **Currently our fallback**

### 7. USyncProtocol / onWhatsApp()
- **Available to Baileys?** YES — but rate-limited
- `sock.onWhatsApp('919986273519@s.whatsapp.net')` returns `{ exists, jid }` but NOT the name
- Can verify if a number is on WhatsApp but doesn't give profile names
- **Not useful for name resolution**

### Name resolution priority (what we should use)

```
pushName (live message) > verifiedBizName > contacts.notify > phone number
```

Contact names from your phone are **not accessible** — this is a fundamental limitation.

---

## Current Issues Mapped to Root Causes

### Issue 1: Duplicate sidebar entries
**Example:** `919035981332@s.whatsapp.net` + `Aman Moulders` (under LID)
**Root cause:** Chat entries created under both LID and phone JID formats. Our dedup filter hides LIDs with jid_map entries, but misses LIDs not in jid_map.
**Fix needed:** When a DM arrives from a LID and we know the phone JID (from the chat_id normalization), create the jid_map entry immediately. Then dedup works.

### Issue 2: Missing sender names in group messages
**Example:** Group messages show phone numbers or nothing
**Root cause:** History sync doesn't include pushName. Group metadata doesn't include names. The only name source is live pushName.
**Fix needed:** Already partially fixed — jid_map stores phone numbers as fallback, pushName replaces them on live messages. Over time this self-heals.

### Issue 3: Status messages without attribution
**Example:** Stories show "Status" or blank as sender
**Root cause:** History sync status messages have `sender_id = status@broadcast` (no participant data) or a LID with no name mapping.
**Fix needed:** For status messages, the sender is in `raw.participant`. Our migration fixed 27/41 — the rest truly have no sender data in raw_json.

### Issue 4: Device-specific JID duplicates
**Example:** `919986273519:48@s.whatsapp.net` vs `919986273519@s.whatsapp.net`
**Root cause:** Baileys includes device index in JID. Our normalizer strips it using `jidNormalizedUser()`.
**Status:** FIXED — migration normalized all device JIDs.

### Issue 5: Messages split across IDs for same person
**Example:** Clicking a DM shows only some messages; others stored under LID chat_id
**Root cause:** Some messages stored with LID as chat_id, others with phone JID.
**Fix needed:** Normalize chat_id at write time (done for new messages). Migration for existing data (done — moved 34 messages). But misses cases where no jid_map entry exists.

### Issue 6: API queries miss messages
**Example:** `GET /api/messages?chatId=919035981332@s.whatsapp.net` misses messages under LID
**Root cause:** Query filters by exact chat_id match. No cross-reference to other IDs for the same person.
**Fix needed:** API should expand chatId to include all known aliases (phone JID + all mapped LIDs).

---

## What's Fixed vs What's Not

### Fixed
- [x] Device suffix normalization (`:48@` → `@`)
- [x] LID→phone JID mapping from group metadata (3682 mappings)
- [x] jid_map table for persistent LID↔phone mapping
- [x] Dedup filter in getChats() hides LIDs with phone mappings
- [x] status@broadcast named "Stories", excluded from name updates
- [x] pushName persisted to jid_map from live messages
- [x] Name resolution via JOIN on jid_map in getMessages/getMedia
- [x] Chat_id normalization at write time for new LID DMs

### Not Fixed
- [ ] LIDs not in any group (DM-only contacts) have no jid_map entry
- [ ] Phone JID chats have empty names when LID has the name
- [ ] API chatId queries don't expand to aliases
- [ ] Contact names from phone address book (IMPOSSIBLE via Baileys)
- [ ] Historical messages with LID chat_id where no mapping was available
- [ ] Status messages with no participant data in raw_json (14 of 41)

---

## Consolidation Goal

### At point of consumption:
```
Input:  chatId = "919035981332@s.whatsapp.net" OR "919035981332" OR "123055108059233@lid"
Output: All messages for this person, regardless of which ID format they were stored under

Name:   "Aman Moulders" (from pushName) — resolved at query time
```

### What needs to happen:
1. **Canonical ID:** Every person has ONE canonical ID (phone JID when known, LID otherwise)
2. **Alias expansion:** API queries expand any alias to find all messages
3. **Name resolution:** Best name from any source, applied to all aliases
4. **Dedup:** Sidebar shows one entry per person, consolidating all aliases
5. **Separation:** DMs, Groups, Stories remain distinct (they already are — different chat_id formats)

### What's technically possible vs impossible:
| Goal | Possible? | How |
|---|---|---|
| Consolidate same person's messages | YES | Normalize all IDs to canonical form at storage time |
| Show best available name | YES | COALESCE across jid_map, chats, pushName |
| Show contact name from phone | NO | WhatsApp doesn't share address book with linked devices |
| Deduplicate sidebar | MOSTLY | jid_map dedup works for known mappings; unknown LIDs still appear separately |
| Auto-discover LID↔phone mapping | PARTIALLY | Group metadata gives it; DM-only contacts need a live message to establish the link |

---

---

## Learnings from Beeper / Matrix / mautrix-whatsapp

### How Matrix solves identity

Matrix creates a **"ghost"** — a virtual Matrix user — for each WhatsApp contact. Example: `@whatsapp_919986273519:beeper.com`. ALL messages from that person, regardless of which JID format they arrived under, are attributed to this single ghost. The ghost is the canonical identity.

Before mautrix-whatsapp v0.5.0, ghosts used phone numbers: `@whatsapp_<phonenumber>`. After WhatsApp's LID migration, they changed to `@whatsapp_lid-<randomnumber>`. They had to build migration logic to re-link old phone-based ghosts to new LID-based ones — **the exact same problem we're solving.**

### Key patterns we should adopt

**1. Separate JID conversion from name resolution**
- mautrix-whatsapp has `IdentifierResolvingNetworkAPI` for JID conversion (deterministic, no DB lookups)
- And separate `ContactListingNetworkAPI` + `UserSearchingNetworkAPI` for name resolution (searches pushName, full name, phone)
- We should keep `resolveCanonicalJid()` and `resolveDisplayName()` as separate concerns

**2. Store raw data separately from processed data**
- mautrix stores raw history sync messages in `whatsapp_history_sync_message`, separate from processed messages
- This lets them re-process when mappings improve later
- We already have `raw_json` on every message — same principle, confirmed approach

**3. Queue unknown identities for later resolution**
- mautrix has `whatsapp_media_backfill_request` for deferred processing
- We should apply this to identity: when we encounter an unknown LID, store it and resolve later rather than blocking

**4. The `lid-mapping.update` event is critical**
- This is the **direct LID↔phone mapping** from WhatsApp, fired on device sync
- Most reliable source of mappings — more reliable than group metadata inference
- mautrix-whatsapp wires this up as a primary mapping source
- **We haven't implemented this yet — highest priority addition**

**5. Contact names from phone are a privacy concern in multi-user bridges**
- mautrix-whatsapp deliberately doesn't use phone contact names by default because "they cause problems if your bridge has multiple Matrix users with the same people in their contact lists"
- For our single-user system this isn't a concern, but it confirms that pushName is the standard name source for linked device approaches

### What we can't replicate from Beeper

- **Phone address book sync** — Beeper's setup flow includes a contact import step that bridges contacts from your phone. This is a Beeper-specific feature that uses their proprietary mobile app, not WhatsApp's protocol. We can't do this via Baileys.
- **Matrix user ID stability** — Matrix has a dedicated identity server (IS) that handles third-party ID lookups. We don't have this layer — our identities table is the equivalent.

---

## Final Implementation Plan

### Architecture: Storage-time normalization with in-memory cache

All IDs are rewritten to a **canonical form** before storing in the DB. `raw_json` is preserved intact (original IDs always recoverable). An in-memory cache makes normalization O(1) per message.

### Canonical ID rules

```
Device JID    919986273519:48@s.whatsapp.net  → 919986273519@s.whatsapp.net  (strip device suffix)
LID (mapped)  256040230715399@lid             → 919986273519@s.whatsapp.net  (use identities table)
LID (unknown) 123055108059233@lid             → 123055108059233@lid          (keep as-is until mapping discovered)
Group JID     918527657878-1571075145@g.us    → 918527657878-1571075145@g.us (unchanged)
Status        status@broadcast                → status@broadcast             (unchanged)
Bare phone    919986273519                    → 919986273519@s.whatsapp.net  (append suffix)
```

### The `identities` table (replaces `jid_map`)

```sql
CREATE TABLE identities (
  canonical_jid TEXT NOT NULL,       -- the one true ID (phone JID when known)
  alias_jid TEXT PRIMARY KEY,        -- any JID that maps to this person
  display_name TEXT DEFAULT '',      -- best known name
  name_source TEXT DEFAULT '',       -- 'pushName' | 'verifiedBizName' | 'contact' | 'phone'
  updated_at INTEGER
);
CREATE INDEX idx_identities_canonical ON identities(canonical_jid);
```

Multiple aliases → one canonical. Example:
```
canonical_jid                 | alias_jid                    | display_name    | name_source
919035981332@s.whatsapp.net  | 919035981332@s.whatsapp.net  | Aman Moulders   | pushName
919035981332@s.whatsapp.net  | 123055108059233@lid          | Aman Moulders   | pushName
```

### In-memory cache (`identityCache`)

```typescript
private identityCache: Map<string, string>  // alias_jid → canonical_jid
```

- Loaded from `identities` table on server start
- Updated immediately when new mappings are discovered
- `resolveCanonicalJid()` checks cache first (O(1)), DB on miss, caches result

### Mapping discovery — 4 sources

| Source | When | Action |
|---|---|---|
| `groupMetadata()` | On connect | INSERT identities + cache. **Defer** cascade UPDATE of old messages to background. |
| `lid-mapping.update` | On device sync | INSERT identities + cache. **Defer** cascade UPDATE. (NEW — not yet wired) |
| Live DM from LID | On message | If `key.remoteJid` is LID but chat resolves to phone JID: INSERT identity + cache. New message stored under canonical. |
| `contacts.upsert` | On connect | UPDATE display_name on existing identities. INSERT new entries with contact name. |

**Critical: cascade UPDATEs are always deferred.** Discovery writes to `identities` immediately (fast INSERT). Rewriting old messages/chats runs on `setTimeout` or a periodic background job. New messages use the fresh mapping at write time.

### Name resolution

Priority (numeric, higher wins):
```
pushName: 4          — from live message, freshest
verifiedBizName: 3   — from raw message, business accounts
contact: 2           — from contacts.upsert notify field
phone: 1             — phone number fallback
```

Overwrite rule: **same or higher priority always overwrites.** A new pushName replaces an old pushName (name change). A phone number never replaces a pushName.

At query time:
```sql
LEFT JOIN identities i ON m.sender_id = i.alias_jid
-- use i.display_name for sender name
```

### Chat deduplication

```sql
WHERE id NOT IN (
  SELECT alias_jid FROM identities WHERE canonical_jid != alias_jid
)
```

Excludes aliases from the chat list. Only canonical entries show. Names resolved from identities table.

### API input resolution

Every API route handler resolves input chatId before querying:
```typescript
const resolvedChatId = identityCache.get(chatId) ?? chatId
```

Any alias works as input — transparently resolved to canonical.

### Migration

1. Create `identities` table
2. Seed from existing `jid_map` (LID→phone mappings become identity entries)
3. Seed from `chats` table (each chat ID becomes a self-referencing identity with its name)
4. For every known LID→phone mapping: batch UPDATE `messages.chat_id` and `messages.sender_id`
5. Merge duplicate `chats` entries (keep canonical, delete aliases, merge timestamps)
6. Drop `jid_map` table

### Files to change

| File | Changes |
|---|---|
| `core/jid.ts` | Add `resolveCanonicalJid()` (cache-backed) |
| `adapters/baileys/store.ts` | `identities` table, `upsertIdentity`, `getCanonicalJid`, `resolveDisplayName`, update JOINs, dedup in `getChats` |
| `adapters/baileys/index.ts` | Wire `lid-mapping.update`, normalize in `normaliseMessage`, update `syncGroupMemberNames`, deferred cascade |
| `routes/api.ts` | Resolve chatId input at start of each handler |
| `migrations/` | Build identities, normalize data, merge chats, drop jid_map |

### What stays unsolvable

- **14 history-synced status messages** with no sender data in raw_json — permanently anonymous
- **DM-only contacts not in any group** where no live message has arrived — LID stays as canonical until mapping discovered via `lid-mapping.update` or live message
- **Phone address book names** — impossible via any linked device approach (Baileys, whatsmeow, or any other)
