import type Database from 'better-sqlite3'

/**
 * Backfill mime_type for existing non-text messages from raw_json.
 *
 * The mime_type column was added after messages were already stored.
 * Existing non-text messages have mime_type = NULL but the data
 * exists in raw_json as message.[type]Message.mimetype.
 */
export function up(db: Database.Database): void {
  const rows = db.prepare(
    "SELECT id, type, raw_json FROM messages WHERE type != 'text' AND mime_type IS NULL AND raw_json IS NOT NULL"
  ).all() as { id: string; type: string; raw_json: string }[]

  if (rows.length === 0) {
    console.log('[migrations] backfill-mime-type: no rows to fix')
    return
  }

  const update = db.prepare('UPDATE messages SET mime_type = ? WHERE id = ?')

  let fixed = 0
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.raw_json)
      const mimeType = raw.message?.[`${row.type}Message`]?.mimetype
      if (!mimeType) continue
      update.run(mimeType, row.id)
      fixed++
    } catch {
      // Skip rows with invalid raw_json
    }
  }

  console.log(`[migrations] backfill-mime-type: fixed ${fixed} of ${rows.length} media messages`)
}
