import type Database from 'better-sqlite3'

/**
 * Build the identities table from existing data and normalize JIDs.
 *
 * 1. Create identities table if not exists
 * 2. Seed from jid_map (LID→phone mappings)
 * 3. Seed from chats (each chat becomes a self-referencing identity)
 * 4. Normalize messages: rewrite LID chat_ids/sender_ids to phone JIDs
 * 5. Merge duplicate chat entries
 * 6. Drop jid_map table
 */
export function up(db: Database.Database): void {
  // Ensure identities table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      canonical_jid TEXT NOT NULL,
      alias_jid TEXT PRIMARY KEY,
      display_name TEXT DEFAULT '',
      name_source TEXT DEFAULT '',
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_identities_canonical ON identities(canonical_jid);
  `)

  const now = Math.floor(Date.now() / 1000)

  // Step 1: Seed from jid_map (if it exists)
  let seededFromJidMap = 0
  try {
    const jidMappings = db.prepare('SELECT lid, phone_jid, display_name FROM jid_map').all() as { lid: string; phone_jid: string; display_name: string }[]
    for (const { lid, phone_jid, display_name } of jidMappings) {
      const canonical = phone_jid !== lid ? phone_jid : lid
      const nameSource = display_name && !display_name.match(/^\d+$/) ? 'contact' : 'phone'
      // Insert alias entry
      db.prepare('INSERT OR IGNORE INTO identities (canonical_jid, alias_jid, display_name, name_source, updated_at) VALUES (?, ?, ?, ?, ?)').run(canonical, lid, display_name, nameSource, now)
      // Insert canonical self-reference
      if (canonical !== lid) {
        db.prepare('INSERT OR IGNORE INTO identities (canonical_jid, alias_jid, display_name, name_source, updated_at) VALUES (?, ?, ?, ?, ?)').run(canonical, canonical, display_name, nameSource, now)
      }
      seededFromJidMap++
    }
  } catch {
    // jid_map might not exist
  }

  // Step 2: Seed from chats (self-referencing identity for each chat with a name)
  let seededFromChats = 0
  const chats = db.prepare("SELECT id, name FROM chats WHERE name != '' AND id NOT LIKE '%@g.us' AND id != 'status@broadcast'").all() as { id: string; name: string }[]
  for (const { id, name } of chats) {
    const nameSource = name.match(/^\d+$/) ? 'phone' : 'contact'
    db.prepare('INSERT OR IGNORE INTO identities (canonical_jid, alias_jid, display_name, name_source, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, id, name, nameSource, now)
    seededFromChats++
  }

  console.log(`[migrations] build-identities: seeded ${seededFromJidMap} from jid_map, ${seededFromChats} from chats`)

  // Step 3: Normalize messages — rewrite LID chat_ids to phone JIDs where mapping exists
  const lidMappings = db.prepare("SELECT alias_jid, canonical_jid FROM identities WHERE alias_jid != canonical_jid AND alias_jid LIKE '%@lid'").all() as { alias_jid: string; canonical_jid: string }[]

  let normalizedChatIds = 0
  let normalizedSenderIds = 0
  for (const { alias_jid, canonical_jid } of lidMappings) {
    const chatResult = db.prepare('UPDATE messages SET chat_id = ? WHERE chat_id = ?').run(canonical_jid, alias_jid)
    const senderResult = db.prepare('UPDATE messages SET sender_id = ? WHERE sender_id = ?').run(canonical_jid, alias_jid)
    normalizedChatIds += chatResult.changes
    normalizedSenderIds += senderResult.changes
  }

  console.log(`[migrations] build-identities: normalized ${normalizedChatIds} chat_ids, ${normalizedSenderIds} sender_ids`)

  // Step 4: Merge duplicate chats (LID → phone JID)
  let mergedChats = 0
  for (const { alias_jid, canonical_jid } of lidMappings) {
    const aliasChat = db.prepare('SELECT id FROM chats WHERE id = ?').get(alias_jid)
    if (aliasChat) {
      db.prepare('DELETE FROM chats WHERE id = ?').run(alias_jid)
      mergedChats++
    }
  }

  console.log(`[migrations] build-identities: merged ${mergedChats} duplicate chats`)

  // Step 5: Drop jid_map
  try {
    db.exec('DROP TABLE IF EXISTS jid_map')
    console.log('[migrations] build-identities: dropped jid_map table')
  } catch { /* already gone */ }
}
