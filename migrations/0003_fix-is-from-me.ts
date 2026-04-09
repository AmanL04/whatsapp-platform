import type Database from 'better-sqlite3'

/**
 * Fix is_from_me for messages sent from other linked devices (phone, Beeper).
 *
 * These messages arrived with raw.key.fromMe undefined and were stored as
 * is_from_me = 0. This migration finds the user's canonical JID(s) from
 * messages already correctly tagged, then updates all their messages.
 */
export function up(db: Database.Database) {
  // Find all JIDs that belong to the user:
  // 1. sender_ids from messages already marked is_from_me = 1
  // 2. All aliases in identities that map to those canonical JIDs
  const result = db.prepare(`
    UPDATE messages SET is_from_me = 1
    WHERE is_from_me = 0
    AND sender_id IN (
      SELECT alias_jid FROM identities WHERE canonical_jid IN (
        SELECT DISTINCT sender_id FROM messages WHERE is_from_me = 1
      )
      UNION
      SELECT DISTINCT sender_id FROM messages WHERE is_from_me = 1
    )
  `).run()

  if (result.changes > 0) {
    console.log(`[migrations] fixed is_from_me on ${result.changes} messages`)
  }
}
