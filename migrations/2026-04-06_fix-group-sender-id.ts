import type Database from 'better-sqlite3'

/**
 * Backfill sender_id and sender_name for group messages.
 *
 * History-synced group messages stored sender_id as the group JID (chat_id)
 * because the normaliser only checked raw.key.participant (undefined for
 * history sync). The real sender is at raw.participant in the raw_json.
 */
export function up(db: Database.Database): void {
  const rows = db.prepare(
    "SELECT id, chat_id, raw_json FROM messages WHERE is_group = 1 AND sender_id = chat_id AND raw_json IS NOT NULL"
  ).all() as { id: string; chat_id: string; raw_json: string }[]

  if (rows.length === 0) {
    console.log('[migrations] fix-group-sender-id: no rows to fix')
    return
  }

  const update = db.prepare(
    'UPDATE messages SET sender_id = ?, sender_name = ? WHERE id = ?'
  )

  let fixed = 0
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.raw_json)
      const senderId = raw.key?.participant ?? raw.participant
      if (!senderId || senderId === row.chat_id) continue

      const senderName = raw.pushName || ''
      update.run(senderId, senderName, row.id)
      fixed++
    } catch {
      // Skip rows with invalid raw_json
    }
  }

  console.log(`[migrations] fix-group-sender-id: fixed ${fixed} of ${rows.length} group messages`)
}
