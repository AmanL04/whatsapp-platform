import type Database from 'better-sqlite3'

/**
 * Rename status@broadcast chat from "Status" to "Stories".
 */
export function up(db: Database.Database): void {
  db.prepare("UPDATE chats SET name = 'Stories' WHERE id = 'status@broadcast'").run()
  console.log('[migrations] rename-status-to-stories: done')
}
