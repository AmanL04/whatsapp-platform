import type Database from 'better-sqlite3'

/**
 * Link LID chat entries to phone JID chats.
 *
 * When a DM arrives from a LID, Baileys stores the message under
 * the phone JID chat_id but the sender_id is the LID. If the LID
 * has a name (from pushName) but no jid_map entry linking it to
 * the phone JID, the phone JID chat shows no name.
 *
 * This migration finds LID chats with names, checks if messages
 * exist linking them to phone JID chats, and creates jid_map entries.
 */
export function up(db: Database.Database): void {
  // Skip if jid_map was already dropped by build-identities migration
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jid_map'").get()
  if (!tableExists) {
    console.log('[migrations] link-lid-chats-to-phone: skipped (jid_map already dropped)')
    return
  }

  const lidChats = db.prepare(`
    SELECT c.id as lid, c.name
    FROM chats c
    LEFT JOIN jid_map jm ON c.id = jm.lid
    WHERE c.id LIKE '%@lid'
      AND c.name != ''
      AND (jm.lid IS NULL OR jm.phone_jid = jm.lid)
  `).all() as { lid: string; name: string }[]

  let linked = 0
  for (const { lid, name } of lidChats) {
    // Find messages where sender_id = this LID and chat_id is a phone JID
    const msg = db.prepare(`
      SELECT DISTINCT chat_id FROM messages
      WHERE sender_id = ? AND chat_id LIKE '%@s.whatsapp.net'
      LIMIT 1
    `).get(lid) as { chat_id: string } | undefined

    if (msg) {
      db.prepare(`
        INSERT INTO jid_map (lid, phone_jid, display_name, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(lid) DO UPDATE SET
          phone_jid = excluded.phone_jid,
          display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE jid_map.display_name END,
          updated_at = excluded.updated_at
      `).run(lid, msg.chat_id, name, Math.floor(Date.now() / 1000))
      linked++
    }
  }

  console.log(`[migrations] link-lid-chats-to-phone: linked ${linked} LID chats to phone JIDs`)
}
