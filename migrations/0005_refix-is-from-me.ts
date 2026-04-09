import type Database from 'better-sqlite3'

/**
 * Re-run is_from_me fix for messages stored after migration 0003.
 * The code fix (0003's companion commit) used ?? instead of ||,
 * so messages from other linked devices were still stored as is_from_me = 0.
 * Same logic as 0003 — find user's JIDs, update all their messages.
 */
export function up(db: Database.Database) {
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
    console.log(`[migrations] re-fixed is_from_me on ${result.changes} messages`)
  }
}
