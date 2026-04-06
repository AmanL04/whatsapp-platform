import type Database from 'better-sqlite3'

/**
 * Initial schema — all tables and indexes.
 * On a fresh DB this runs first. On an existing DB where init() already
 * created the tables, CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
 * are no-ops, so this migration is safe to run retroactively.
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      content TEXT,
      type TEXT DEFAULT 'text',
      mime_type TEXT,
      timestamp INTEGER,
      is_from_me INTEGER DEFAULT 0,
      is_group INTEGER DEFAULT 0,
      group_name TEXT,
      reply_to TEXT,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      last_message_at INTEGER,
      unread_count INTEGER DEFAULT 0,
      participants TEXT,
      group_metadata_updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      webhook_global_url TEXT,
      webhook_secret TEXT,
      webhook_events TEXT,
      api_key TEXT NOT NULL,
      permissions TEXT,
      scope_chat_types TEXT,
      scope_specific_chats TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      event TEXT,
      payload TEXT,
      status TEXT,
      attempts INTEGER DEFAULT 0,
      last_attempt_at INTEGER,
      response_status INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS identities (
      canonical_jid TEXT NOT NULL,
      alias_jid TEXT PRIMARY KEY,
      display_name TEXT DEFAULT '',
      name_source TEXT DEFAULT '',
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER,
      PRIMARY KEY (message_id, sender_id)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(timestamp DESC) WHERE type != 'text';
    CREATE INDEX IF NOT EXISTS idx_chats_last_msg ON chats(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chats_group ON chats(is_group) WHERE is_group = 1;
    CREATE INDEX IF NOT EXISTS idx_deliveries_app_ts ON webhook_deliveries(app_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deliveries_status_ts ON webhook_deliveries(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_identities_canonical ON identities(canonical_jid);
  `)
}
