import type Database from 'better-sqlite3'

/**
 * Fix status@broadcast chat name.
 *
 * The upsertMessage logic was setting the status@broadcast chat name
 * to the last status poster's name (e.g. "Dinesh Kalbhi") because
 * it treated it like a DM. Reset it to "Status".
 */
export function up(db: Database.Database): void {
  db.prepare("UPDATE chats SET name = 'Status' WHERE id = 'status@broadcast'").run()
  console.log('[migrations] fix-status-broadcast-name: reset status@broadcast name to Status')
}
