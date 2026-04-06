import type Database from 'better-sqlite3'

/**
 * Normalize LID chat_ids to phone JIDs in messages.
 *
 * Some DM messages have chat_id as a LID (e.g. 72438968799410@lid)
 * instead of the phone JID (918971190672@s.whatsapp.net). This causes
 * messages to be split across two chat entries. Normalize them using
 * the jid_map table.
 */
export function up(db: Database.Database): void {
  const mappings = db.prepare(
    "SELECT lid, phone_jid FROM jid_map WHERE phone_jid != lid AND phone_jid LIKE '%@s.whatsapp.net'"
  ).all() as { lid: string; phone_jid: string }[]

  let fixed = 0
  for (const { lid, phone_jid } of mappings) {
    const result = db.prepare('UPDATE messages SET chat_id = ? WHERE chat_id = ?').run(phone_jid, lid)
    if (result.changes > 0) {
      fixed += result.changes
      // Also merge the chat entries
      const lidChat = db.prepare('SELECT last_message_at, unread_count FROM chats WHERE id = ?').get(lid) as { last_message_at: number; unread_count: number } | undefined
      if (lidChat) {
        // Update phone JID chat with latest timestamp
        db.prepare(`
          INSERT INTO chats (id, name, is_group, last_message_at, unread_count)
          VALUES (?, '', 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            last_message_at = MAX(chats.last_message_at, excluded.last_message_at),
            unread_count = chats.unread_count + excluded.unread_count
        `).run(phone_jid, lidChat.last_message_at, lidChat.unread_count)
      }
    }
  }

  console.log(`[migrations] normalize-lid-chat-ids: moved ${fixed} messages from LID to phone JID chat_ids`)
}
