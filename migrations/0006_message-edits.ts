import type Database from 'better-sqlite3'

/**
 * Add edited_at column to messages table and create message_edits history table.
 */
export function up(db: Database.Database) {
  // Add edited_at to messages (idempotent check)
  const cols = (db.pragma('table_info(messages)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('edited_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER')
  }

  // Create edit history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_edits (
      message_id TEXT NOT NULL,
      old_content TEXT,
      edited_at INTEGER,
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_edits_msg ON message_edits(message_id);
  `)
}
