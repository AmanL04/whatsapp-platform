import type Database from 'better-sqlite3'

/**
 * OAuth 2.1 tables for MCP server authentication.
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_id_issued_at INTEGER,
      client_secret_expires_at INTEGER,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS mcp_auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scopes TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      refresh_token TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_refresh ON mcp_tokens(refresh_token);
  `)
}
