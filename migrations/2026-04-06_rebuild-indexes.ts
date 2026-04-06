import type Database from 'better-sqlite3'

/**
 * Drop all existing indexes and create an optimized set.
 *
 * Reduces from 9 indexes to 5. Removes redundant and unused indexes,
 * fixes sort directions to match query ORDER BY clauses, and adds
 * a composite (status, created_at) for delivery retry + cleanup queries.
 */
export function up(db: Database.Database): void {
  // Drop all old indexes
  db.exec(`
    DROP INDEX IF EXISTS idx_messages_chat;
    DROP INDEX IF EXISTS idx_messages_ts;
    DROP INDEX IF EXISTS idx_messages_type;
    DROP INDEX IF EXISTS idx_messages_media;
    DROP INDEX IF EXISTS idx_chats_last_msg;
    DROP INDEX IF EXISTS idx_apps_api_key;
    DROP INDEX IF EXISTS idx_apps_active;
    DROP INDEX IF EXISTS idx_deliveries_app;
    DROP INDEX IF EXISTS idx_deliveries_created;
  `)

  // Create optimized set
  db.exec(`
    CREATE INDEX idx_messages_chat_ts ON messages(chat_id, timestamp DESC);
    CREATE INDEX idx_messages_media ON messages(timestamp DESC) WHERE type != 'text';
    CREATE INDEX idx_chats_last_msg ON chats(last_message_at DESC);
    CREATE INDEX idx_deliveries_app_ts ON webhook_deliveries(app_id, created_at DESC);
    CREATE INDEX idx_deliveries_status_ts ON webhook_deliveries(status, created_at);
  `)

  console.log('[migrations] rebuild-indexes: replaced 9 indexes with 5 optimized ones')
}
