import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import type { Chat, Message, MessageQuery } from '../../core/types'

export class SQLiteStore {
  private db: Database.Database
  private encryptionKey: string | null

  /** Expose raw DB for migrations runner */
  getDb(): Database.Database { return this.db }

  constructor(dbPath = './data/whatsapp.db', encryptionKey?: string) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.encryptionKey = encryptionKey ?? null
    this.init()
  }

  private init() {
    this.db.exec(`
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
        unread_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
      CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(timestamp DESC) WHERE type != 'text';
      CREATE INDEX IF NOT EXISTS idx_chats_last_msg ON chats(last_message_at DESC);

      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS summaries;
      DROP TABLE IF EXISTS media;

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

      CREATE INDEX IF NOT EXISTS idx_apps_api_key ON apps(api_key);
      CREATE INDEX IF NOT EXISTS idx_apps_active ON apps(active);
      CREATE INDEX IF NOT EXISTS idx_deliveries_app ON webhook_deliveries(app_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_deliveries_created ON webhook_deliveries(created_at);
    `)
  }

  // ─── Batch operations ───────────────────────────────────────────────────────

  /** Wrap multiple inserts in a single transaction — much faster for bulk writes */
  runInTransaction(fn: () => void) {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  upsertMessage(msg: Message, rawJson?: string) {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages
        (id, chat_id, sender_id, sender_name, content, type, mime_type, timestamp, is_from_me, is_group, group_name, reply_to, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.chatId,
      msg.senderId,
      msg.senderName,
      msg.content,
      msg.type,
      msg.mimeType ?? null,
      Math.floor(msg.timestamp.getTime() / 1000),
      msg.isFromMe ? 1 : 0,
      msg.isGroup ? 1 : 0,
      msg.groupName ?? null,
      msg.replyTo ?? null,
      rawJson ?? null,
    )

    // Update chat record — only set name if we have a reliable source (groupName or
    // non-fromMe senderName). Never overwrite a good name with the user's own name.
    const chatName = msg.isGroup
      ? (msg.groupName ?? '')
      : (msg.isFromMe ? '' : msg.senderName)
    this.db.prepare(`
      INSERT INTO chats (id, name, is_group, last_message_at, unread_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
        last_message_at = MAX(chats.last_message_at, excluded.last_message_at),
        unread_count = chats.unread_count + 1
    `).run(
      msg.chatId,
      chatName,
      msg.isGroup ? 1 : 0,
      Math.floor(msg.timestamp.getTime() / 1000),
    )
  }

  getMessages(query: MessageQuery): Message[] {
    let sql = `SELECT m.*,
      COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
      COALESCE(c_sender.name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN chats c_sender ON m.sender_id = c_sender.id
      WHERE 1=1`
    const params: any[] = []

    if (query.chatId) {
      sql += ' AND m.chat_id = ?'
      params.push(query.chatId)
    }
    if (query.since) {
      sql += ' AND m.timestamp >= ?'
      params.push(Math.floor(query.since.getTime() / 1000))
    }
    if (query.search) {
      sql += ' AND m.content LIKE ?'
      params.push(`%${query.search}%`)
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(Math.min(query.limit ?? 20, 100))

    return this.db.prepare(sql).all(...params).map(this.rowToMessageWithResolvedNames)
  }

  searchMessages(text: string): Message[] {
    return this.db.prepare(
      `SELECT m.*,
        COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
        COALESCE(c_sender.name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN chats c_sender ON m.sender_id = c_sender.id
      WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT 100`
    ).all(`%${text}%`).map(this.rowToMessageWithResolvedNames)
  }

  getRawJson(messageId: string): string | null {
    const row = this.db.prepare('SELECT raw_json FROM messages WHERE id = ?').get(messageId) as any
    return row?.raw_json ?? null
  }

  // ─── Chats ─────────────────────────────────────────────────────────────────

  upsertChat(id: string, name: string, isGroup: boolean) {
    this.db.prepare(`
      INSERT INTO chats (id, name, is_group, last_message_at, unread_count)
      VALUES (?, ?, ?, 0, 0)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_group = excluded.is_group
    `).run(id, name, isGroup ? 1 : 0)
  }

  getChats(limit = 200): Chat[] {
    return this.db.prepare(
      'SELECT * FROM chats ORDER BY last_message_at DESC LIMIT ?'
    ).all(Math.min(limit, 100)).map(this.rowToChat)
  }

  // ─── Media (queries messages table where type != 'text') ────────────────────

  getMedia(filters: { type?: string; sender?: string; source?: 'chat' | 'story'; limit?: number } = {}) {
    let sql = `SELECT m.*,
      COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
      COALESCE(c_sender.name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN chats c_sender ON m.sender_id = c_sender.id
      WHERE m.type != 'text'`
    const params: (string | number)[] = []

    if (filters.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }
    if (filters.sender) {
      sql += ' AND COALESCE(c_sender.name, m.sender_name) LIKE ?'
      params.push(`%${filters.sender}%`)
    }
    if (filters.source === 'story') {
      sql += " AND m.chat_id = 'status@broadcast'"
    } else if (filters.source === 'chat') {
      sql += " AND m.chat_id != 'status@broadcast'"
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(Math.min(filters.limit ?? 20, 100))

    return this.db.prepare(sql).all(...params).map(this.rowToMessageWithResolvedNames)
  }

  // ─── Encryption helpers ─────────────────────────────────────────────────────
  // Protects api_key and webhook_secret columns at rest. The threat model is
  // DB file exfiltration without env vars (e.g. backup leak, volume export).

  encryptField(value: string): string {
    if (!this.encryptionKey) return value
    const iv = crypto.randomBytes(16)
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('hex')
  }

  decryptField(value: string): string {
    if (!this.encryptionKey) return value
    const [ivHex, encHex] = value.split(':')
    if (!ivHex || !encHex) return value // not encrypted, return as-is
    const iv = Buffer.from(ivHex, 'hex')
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32)
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()])
    return decrypted.toString('utf8')
  }

  // ─── Apps ──────────────────────────────────────────────────────────────────

  insertApp(app: {
    id: string
    name: string
    description: string
    webhookGlobalUrl: string
    webhookSecret: string
    webhookEvents: { name: string; url?: string }[]
    apiKey: string
    permissions: string[]
    scopeChatTypes: string[]
    scopeSpecificChats: string[]
  }) {
    this.db.prepare(`
      INSERT INTO apps
        (id, name, description, webhook_global_url, webhook_secret, webhook_events, api_key, permissions, scope_chat_types, scope_specific_chats, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      app.id,
      app.name,
      app.description,
      app.webhookGlobalUrl,
      this.encryptField(app.webhookSecret),
      JSON.stringify(app.webhookEvents),
      this.encryptField(app.apiKey),
      JSON.stringify(app.permissions),
      JSON.stringify(app.scopeChatTypes),
      JSON.stringify(app.scopeSpecificChats),
      Math.floor(Date.now() / 1000),
    )
  }

  listApps() {
    const rows = this.db.prepare('SELECT * FROM apps WHERE active = 1 ORDER BY created_at DESC').all() as any[]
    return rows.map(r => this.rowToApp(r))
  }

  getAppById(id: string) {
    const row = this.db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as any
    return row ? this.rowToApp(row) : null
  }

  getAppByApiKey(apiKey: string) {
    // Since api_key is encrypted, we can't do a simple WHERE clause.
    // Load all active apps and compare decrypted keys.
    const rows = this.db.prepare('SELECT * FROM apps WHERE active = 1').all() as any[]
    for (const row of rows) {
      if (this.decryptField(row.api_key) === apiKey) {
        return this.rowToApp(row)
      }
    }
    return null
  }

  updateApp(id: string, fields: Record<string, unknown>) {
    const sets: string[] = []
    const params: any[] = []

    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name) }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description) }
    if (fields.webhookGlobalUrl !== undefined) { sets.push('webhook_global_url = ?'); params.push(fields.webhookGlobalUrl) }
    if (fields.webhookSecret !== undefined) { sets.push('webhook_secret = ?'); params.push(this.encryptField(fields.webhookSecret as string)) }
    if (fields.webhookEvents !== undefined) { sets.push('webhook_events = ?'); params.push(JSON.stringify(fields.webhookEvents)) }
    if (fields.apiKey !== undefined) { sets.push('api_key = ?'); params.push(this.encryptField(fields.apiKey as string)) }
    if (fields.permissions !== undefined) { sets.push('permissions = ?'); params.push(JSON.stringify(fields.permissions)) }
    if (fields.scopeChatTypes !== undefined) { sets.push('scope_chat_types = ?'); params.push(JSON.stringify(fields.scopeChatTypes)) }
    if (fields.scopeSpecificChats !== undefined) { sets.push('scope_specific_chats = ?'); params.push(JSON.stringify(fields.scopeSpecificChats)) }

    if (sets.length === 0) return
    params.push(id)
    this.db.prepare(`UPDATE apps SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  deactivateApp(id: string) {
    this.db.prepare('UPDATE apps SET active = 0 WHERE id = ?').run(id)
  }

  // ─── Webhook Deliveries ────────────────────────────────────────────────────

  insertDelivery(delivery: {
    id: string
    appId: string
    event: string
    payload: string
    status: string
  }) {
    this.db.prepare(`
      INSERT INTO webhook_deliveries (id, app_id, event, payload, status, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(
      delivery.id,
      delivery.appId,
      delivery.event,
      delivery.payload,
      delivery.status,
      Math.floor(Date.now() / 1000),
    )
  }

  updateDelivery(id: string, fields: { status?: string; attempts?: number; lastAttemptAt?: number; responseStatus?: number }) {
    const sets: string[] = []
    const params: any[] = []

    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status) }
    if (fields.attempts !== undefined) { sets.push('attempts = ?'); params.push(fields.attempts) }
    if (fields.lastAttemptAt !== undefined) { sets.push('last_attempt_at = ?'); params.push(fields.lastAttemptAt) }
    if (fields.responseStatus !== undefined) { sets.push('response_status = ?'); params.push(fields.responseStatus) }

    if (sets.length === 0) return
    params.push(id)
    this.db.prepare(`UPDATE webhook_deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  getDeliveries(filters: { appId?: string; status?: string; limit?: number } = {}) {
    let sql = 'SELECT * FROM webhook_deliveries WHERE 1=1'
    const params: any[] = []

    if (filters.appId) { sql += ' AND app_id = ?'; params.push(filters.appId) }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status) }

    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(Math.min(filters.limit ?? 20, 100))

    return this.db.prepare(sql).all(...params)
  }

  getRetryingDeliveries() {
    return this.db.prepare(
      "SELECT * FROM webhook_deliveries WHERE status = 'retrying'"
    ).all()
  }

  deleteOldDeliveries(beforeTimestamp: number): number {
    const result = this.db.prepare('DELETE FROM webhook_deliveries WHERE created_at < ?').run(beforeTimestamp)
    return result.changes
  }

  // ─── Row mappers ───────────────────────────────────────────────────────────

  private rowToMessage(row: any): Message {
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: row.content,
      type: row.type,
      mimeType: row.mime_type ?? undefined,
      timestamp: new Date(row.timestamp * 1000),
      isFromMe: !!row.is_from_me,
      isGroup: !!row.is_group,
      groupName: row.group_name ?? undefined,
      replyTo: row.reply_to ?? undefined,
    }
  }

  /** Like rowToMessage but prefers latest names from chats table via JOIN */
  private rowToMessageWithResolvedNames(row: any): Message {
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName: row.resolved_sender_name || row.sender_name || '',
      content: row.content,
      type: row.type,
      mimeType: row.mime_type ?? undefined,
      timestamp: new Date(row.timestamp * 1000),
      isFromMe: !!row.is_from_me,
      isGroup: !!row.is_group,
      groupName: row.is_group ? (row.resolved_group_name || row.group_name || undefined) : undefined,
      replyTo: row.reply_to ?? undefined,
    }
  }

  private rowToChat(row: any): Chat {
    return {
      id: row.id,
      name: row.name,
      isGroup: !!row.is_group,
      lastMessageAt: new Date(row.last_message_at * 1000),
      unreadCount: row.unread_count,
    }
  }

  private rowToApp(row: any) {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description ?? '') as string,
      webhookGlobalUrl: (row.webhook_global_url ?? '') as string,
      webhookSecret: this.decryptField(row.webhook_secret),
      webhookEvents: JSON.parse(row.webhook_events || '[]') as { name: string; url?: string }[],
      apiKey: this.decryptField(row.api_key),
      permissions: JSON.parse(row.permissions || '[]') as string[],
      scopeChatTypes: JSON.parse(row.scope_chat_types || '[]') as string[],
      scopeSpecificChats: JSON.parse(row.scope_specific_chats || '[]') as string[],
      active: !!row.active,
      createdAt: new Date(row.created_at * 1000),
    }
  }

  close() {
    this.db.close()
  }
}
