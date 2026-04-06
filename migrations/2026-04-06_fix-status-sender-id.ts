import type Database from 'better-sqlite3'

/**
 * Backfill sender_id and sender_name for status messages.
 *
 * History-synced status messages stored sender_id as 'status@broadcast'
 * because the normaliser only checked raw.key.participant (undefined for
 * history sync). The real sender is at raw.participant in the raw_json.
 */
export function up(db: Database.Database): void {
  const rows = db.prepare(
    "SELECT id, raw_json FROM messages WHERE chat_id = 'status@broadcast' AND raw_json IS NOT NULL"
  ).all() as { id: string; raw_json: string }[]

  const update = db.prepare(
    'UPDATE messages SET sender_id = ?, sender_name = ? WHERE id = ?'
  )

  let fixed = 0
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.raw_json)
      const senderId = raw.key?.participant ?? raw.participant
      if (!senderId || senderId === 'status@broadcast') continue

      const senderName = raw.pushName || ''
      update.run(senderId, senderName, row.id)
      fixed++
    } catch {
      // Skip rows with invalid raw_json
    }
  }

  console.log(`[migrations] fix-status-sender-id: fixed ${fixed} of ${rows.length} status messages`)
}
