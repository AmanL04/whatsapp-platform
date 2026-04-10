import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import type { Chat, Message, MessageQuery, Reaction } from '../../core/types'

export class SQLiteStore {
  private db: Database.Database
  private encryptionKey: string | null
  private derivedKey: Buffer | null = null

  /** Expose raw DB for cascade normalization in the adapter */
  getDb(): Database.Database { return this.db }

  constructor(dbPath = './data/whatsapp.db', encryptionKey?: string) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.encryptionKey = encryptionKey ?? null
    // Derive the encryption key once — scryptSync is deliberately slow (~100ms)
    if (this.encryptionKey) {
      this.derivedKey = crypto.scryptSync(this.encryptionKey, 'salt', 32)
    }
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
      INSERT INTO messages
        (id, chat_id, sender_id, sender_name, content, type, mime_type, timestamp, is_from_me, is_group, group_name, reply_to, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chat_id = excluded.chat_id,
        sender_id = excluded.sender_id,
        sender_name = excluded.sender_name,
        content = excluded.content,
        type = excluded.type,
        mime_type = excluded.mime_type,
        timestamp = excluded.timestamp,
        is_from_me = excluded.is_from_me,
        is_group = excluded.is_group,
        group_name = excluded.group_name,
        reply_to = excluded.reply_to,
        raw_json = excluded.raw_json,
        sent_by_app_id = COALESCE(messages.sent_by_app_id, excluded.sent_by_app_id)
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
    // Skip status@broadcast — it's not a real chat, don't let sender names overwrite it.
    if (msg.chatId === 'status@broadcast') return

    const chatName = msg.isGroup
      ? (msg.groupName ?? '')
      : (msg.isFromMe ? '' : msg.senderName)
    this.db.prepare(`
      INSERT INTO chats (id, name, is_group, last_message_at, unread_count)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
        last_message_at = MAX(chats.last_message_at, excluded.last_message_at)
    `).run(
      msg.chatId,
      chatName,
      msg.isGroup ? 1 : 0,
      Math.floor(msg.timestamp.getTime() / 1000),
    )
  }

  editMessage(messageId: string, newContent: string, editedAt: number): { oldContent: string | null; found: boolean } {
    const existing = this.db.prepare(
      'SELECT content FROM messages WHERE id = ?'
    ).get(messageId) as { content: string } | undefined

    if (!existing) return { oldContent: null, found: false }

    this.runInTransaction(() => {
      this.db.prepare(
        'INSERT INTO message_edits (message_id, old_content, edited_at) VALUES (?, ?, ?)'
      ).run(messageId, existing.content, editedAt)

      this.db.prepare(
        'UPDATE messages SET content = ?, edited_at = ? WHERE id = ?'
      ).run(newContent, editedAt, messageId)
    })

    return { oldContent: existing.content, found: true }
  }

  preInsertSentMessage(msg: { id: string; chatId: string; content: string; sentByAppId: string; timestamp: number; isFromMe: boolean; isGroup: boolean }) {
    this.db.prepare(`
      INSERT INTO messages (id, chat_id, content, sent_by_app_id, timestamp, is_from_me, is_group, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'text')
      ON CONFLICT(id) DO UPDATE SET sent_by_app_id = excluded.sent_by_app_id
    `).run(msg.id, msg.chatId, msg.content, msg.sentByAppId, msg.timestamp, msg.isFromMe ? 1 : 0, msg.isGroup ? 1 : 0)
  }

  getSentByAppId(messageId: string): string | null {
    const row = this.db.prepare('SELECT sent_by_app_id FROM messages WHERE id = ?').get(messageId) as { sent_by_app_id: string | null } | undefined
    return row?.sent_by_app_id ?? null
  }

  private static readonly MSG_COLS = 'm.id, m.chat_id, m.sender_id, m.sender_name, m.content, m.type, m.mime_type, m.timestamp, m.is_from_me, m.is_group, m.group_name, m.reply_to, m.edited_at'

  getMessages(query: MessageQuery): Message[] {
    let sql = `SELECT ${SQLiteStore.MSG_COLS},
      COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
      COALESCE(ident.display_name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN identities ident ON m.sender_id = ident.alias_jid
      WHERE 1=1`
    const params: any[] = []

    if (query.chatId) {
      sql += ' AND m.chat_id = ?'
      params.push(query.chatId)
    }
    if (query.after) {
      sql += ' AND m.timestamp > ?'
      params.push(Math.floor(query.after.getTime() / 1000))
    }
    if (query.before) {
      sql += ' AND m.timestamp < ?'
      params.push(Math.floor(query.before.getTime() / 1000))
    }
    if (query.search) {
      sql += ' AND m.content LIKE ?'
      params.push(`%${query.search}%`)
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(Math.min(query.limit ?? 20, 100))

    const messages = this.db.prepare(sql).all(...params).map(this.rowToMessageWithResolvedNames)
    return this.attachReactions(messages)
  }

  searchMessages(text: string, opts: { after?: number; before?: number; limit?: number } = {}): Message[] {
    let sql = `SELECT ${SQLiteStore.MSG_COLS},
      COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
      COALESCE(ident.display_name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN identities ident ON m.sender_id = ident.alias_jid
      WHERE m.content LIKE ?`
    const params: (string | number)[] = [`%${text}%`]

    if (opts.after) {
      sql += ' AND m.timestamp > ?'
      params.push(opts.after)
    }
    if (opts.before) {
      sql += ' AND m.timestamp < ?'
      params.push(opts.before)
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(Math.min(opts.limit ?? 20, 100))

    const messages = this.db.prepare(sql).all(...params).map(this.rowToMessageWithResolvedNames)
    return this.attachReactions(messages)
  }

  getRawJson(messageId: string): string | null {
    const row = this.db.prepare('SELECT raw_json FROM messages WHERE id = ?').get(messageId) as any
    return row?.raw_json ?? null
  }

  getStats() {
    const messages = (this.db.prepare('SELECT COUNT(*) as c FROM messages').get() as any).c
    const chats = (this.db.prepare('SELECT COUNT(*) as c FROM chats').get() as any).c
    const media = (this.db.prepare("SELECT COUNT(*) as c FROM messages WHERE type != 'text'").get() as any).c
    const apps = (this.db.prepare('SELECT COUNT(*) as c FROM apps WHERE active = 1').get() as any).c
    const deliveries = (this.db.prepare('SELECT COUNT(*) as c FROM webhook_deliveries').get() as any).c
    const indexes = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map(r => r.name)
    return { messages, chats, media, apps, deliveries, indexes }
  }

  // ─── Identities ─────────────────────────────────────────────────────────────

  private static readonly NAME_PRIORITY: Record<string, number> = { pushName: 4, verifiedBizName: 3, contact: 2, phone: 1 }

  upsertIdentity(canonicalJid: string, aliasJid: string, displayName?: string, nameSource?: string) {
    const newSource = nameSource ?? ''
    const newPriority = SQLiteStore.NAME_PRIORITY[newSource] ?? 0

    // Check if existing entry has higher priority name
    const existing = this.db.prepare('SELECT display_name, name_source FROM identities WHERE alias_jid = ?').get(aliasJid) as { display_name: string; name_source: string } | undefined
    const existingPriority = existing ? (SQLiteStore.NAME_PRIORITY[existing.name_source] ?? 0) : 0

    const finalName = (displayName && newPriority >= existingPriority) ? displayName : (existing?.display_name ?? displayName ?? '')
    const finalSource = (displayName && newPriority >= existingPriority) ? newSource : (existing?.name_source ?? newSource)

    this.db.prepare(`
      INSERT INTO identities (canonical_jid, alias_jid, display_name, name_source, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(alias_jid) DO UPDATE SET
        canonical_jid = excluded.canonical_jid,
        display_name = excluded.display_name,
        name_source = excluded.name_source,
        updated_at = excluded.updated_at
    `).run(canonicalJid, aliasJid, finalName, finalSource, Math.floor(Date.now() / 1000))

  }

  /** Update display_name for ALL entries sharing a canonical_jid */
  updateIdentityName(canonicalJid: string, displayName: string, nameSource: string) {
    const priority = SQLiteStore.NAME_PRIORITY[nameSource] ?? 0
    const rows = this.db.prepare('SELECT alias_jid, name_source FROM identities WHERE canonical_jid = ?').all(canonicalJid) as { alias_jid: string; name_source: string }[]
    for (const row of rows) {
      const existingPriority = SQLiteStore.NAME_PRIORITY[row.name_source] ?? 0
      if (priority >= existingPriority) {
        this.db.prepare('UPDATE identities SET display_name = ?, name_source = ?, updated_at = ? WHERE alias_jid = ?')
          .run(displayName, nameSource, Math.floor(Date.now() / 1000), row.alias_jid)
      }
    }
  }


  resolveDisplayName(jid: string): string {
    if (!jid) return ''
    // Check identities by alias
    const row = this.db.prepare('SELECT display_name FROM identities WHERE alias_jid = ?').get(jid) as { display_name: string } | undefined
    if (row?.display_name) return row.display_name
    // Check identities by canonical (in case the jid IS the canonical)
    const canonRow = this.db.prepare("SELECT display_name FROM identities WHERE canonical_jid = ? AND display_name != '' LIMIT 1").get(jid) as { display_name: string } | undefined
    if (canonRow?.display_name) return canonRow.display_name
    // Fallback to chats table
    const chatRow = this.db.prepare('SELECT name FROM chats WHERE id = ?').get(jid) as { name: string } | undefined
    return chatRow?.name ?? ''
  }

  loadAllIdentities(): Map<string, string> {
    const map = new Map<string, string>()
    const rows = this.db.prepare('SELECT alias_jid, canonical_jid FROM identities').all() as { alias_jid: string; canonical_jid: string }[]
    for (const r of rows) map.set(r.alias_jid, r.canonical_jid)
    return map
  }

  // ─── Reactions ──────────────────────────────────────────────────────────────

  upsertReaction(messageId: string, senderId: string, emoji: string) {
    this.db.prepare(`
      INSERT OR REPLACE INTO reactions (message_id, sender_id, emoji, created_at)
      VALUES (?, ?, ?, ?)
    `).run(messageId, senderId, emoji, Math.floor(Date.now() / 1000))
  }

  deleteReaction(messageId: string, senderId: string) {
    this.db.prepare('DELETE FROM reactions WHERE message_id = ? AND sender_id = ?').run(messageId, senderId)
  }

  getReactionsForMessages(messageIds: string[]): Map<string, Reaction[]> {
    const map = new Map<string, Reaction[]>()
    if (messageIds.length === 0) return map

    const placeholders = messageIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT r.message_id, r.sender_id, r.emoji, r.created_at,
        COALESCE(ident.display_name, '') AS resolved_sender_name
      FROM reactions r
      LEFT JOIN identities ident ON r.sender_id = ident.alias_jid
      WHERE r.message_id IN (${placeholders})
      ORDER BY r.created_at ASC
    `).all(...messageIds) as any[]

    for (const row of rows) {
      const reaction: Reaction = {
        messageId: row.message_id,
        senderId: row.sender_id,
        senderName: row.resolved_sender_name || '',
        emoji: row.emoji,
        timestamp: new Date(row.created_at * 1000),
      }
      const list = map.get(row.message_id) ?? []
      list.push(reaction)
      map.set(row.message_id, list)
    }
    return map
  }

  private attachReactions(messages: Message[]): Message[] {
    if (messages.length === 0) return messages
    const ids = messages.map(m => m.id)
    const reactionsMap = this.getReactionsForMessages(ids)
    for (const msg of messages) {
      const reactions = reactionsMap.get(msg.id)
      if (reactions && reactions.length > 0) {
        msg.reactions = reactions
      }
    }
    return messages
  }

  // ─── Chats ─────────────────────────────────────────────────────────────────

  upsertChat(id: string, name: string, isGroup: boolean) {
    this.db.prepare(`
      INSERT INTO chats (id, name, is_group, last_message_at, unread_count)
      VALUES (?, ?, ?, 0, 0)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_group = excluded.is_group
    `).run(id, name, isGroup ? 1 : 0)
  }

  updateUnreadCount(id: string, count: number) {
    this.db.prepare('UPDATE chats SET unread_count = ? WHERE id = ?').run(count, id)
  }

  getChats(opts: { after?: number; before?: number; limit?: number } = {}): Chat[] {
    // Exclude alias entries, resolve names from identities
    let sql = `SELECT c.*, COALESCE(NULLIF(i.display_name, ''), c.name) AS resolved_name
      FROM chats c
      LEFT JOIN identities i ON c.id = i.alias_jid
      WHERE c.id NOT IN (SELECT alias_jid FROM identities WHERE canonical_jid != alias_jid)`
    const params: (string | number)[] = []

    if (opts.after) {
      sql += ' AND last_message_at > ?'
      params.push(opts.after)
    }
    if (opts.before) {
      sql += ' AND last_message_at < ?'
      params.push(opts.before)
    }

    sql += ' ORDER BY last_message_at DESC LIMIT ?'
    params.push(Math.min(opts.limit ?? 20, 100))

    const chats = this.db.prepare(sql).all(...params).map(this.rowToChat)

    return chats
  }

  // ─── Group Metadata ────────────────────────────────────────────────────────

  updateGroupMetadata(groupJid: string, subject: string, participants: any[]) {
    this.db.prepare(`
      UPDATE chats SET
        name = CASE WHEN ? != '' THEN ? ELSE name END,
        participants = ?,
        group_metadata_updated_at = ?
      WHERE id = ?
    `).run(subject, subject, JSON.stringify(participants), Math.floor(Date.now() / 1000), groupJid)

    // Ensure chat row exists (if we got metadata before any messages)
    const result = this.db.prepare('SELECT 1 FROM chats WHERE id = ?').get(groupJid)
    if (!result) {
      this.db.prepare(`
        INSERT INTO chats (id, name, is_group, last_message_at, unread_count, participants, group_metadata_updated_at)
        VALUES (?, ?, 1, 0, 0, ?, ?)
      `).run(groupJid, subject, JSON.stringify(participants), Math.floor(Date.now() / 1000))
    }
  }

  getGroupParticipants(groupJid: string): { subject: string; participants: any[] } | null {
    const row = this.db.prepare('SELECT name, participants FROM chats WHERE id = ? AND participants IS NOT NULL').get(groupJid) as { name: string; participants: string } | undefined
    if (!row) return null
    return { subject: row.name || '', participants: JSON.parse(row.participants) }
  }

  loadAllGroupMetadata(): Map<string, { subject: string; participants: any[] }> {
    const map = new Map<string, { subject: string; participants: any[] }>()
    const rows = this.db.prepare('SELECT id, name, participants FROM chats WHERE is_group = 1 AND participants IS NOT NULL').all() as { id: string; name: string; participants: string }[]
    for (const r of rows) {
      map.set(r.id, { subject: r.name || '', participants: JSON.parse(r.participants) })
    }
    return map
  }

  getStaleGroups(maxAgeSeconds: number): string[] {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds
    return (this.db.prepare(
      'SELECT id FROM chats WHERE is_group = 1 AND (group_metadata_updated_at IS NULL OR group_metadata_updated_at < ?)'
    ).all(cutoff) as { id: string }[]).map(r => r.id)
  }

  // ─── Media (queries messages table where type != 'text') ────────────────────

  getMedia(filters: { type?: string; sender?: string; source?: 'chat' | 'story'; after?: number; before?: number; limit?: number } = {}) {
    let sql = `SELECT ${SQLiteStore.MSG_COLS},
      COALESCE(c_chat.name, m.group_name) AS resolved_group_name,
      COALESCE(ident.display_name, m.sender_name) AS resolved_sender_name
      FROM messages m
      LEFT JOIN chats c_chat ON m.chat_id = c_chat.id
      LEFT JOIN identities ident ON m.sender_id = ident.alias_jid
      WHERE m.type != 'text'`
    const params: (string | number)[] = []

    if (filters.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }
    if (filters.sender) {
      sql += ' AND COALESCE(ident.display_name, m.sender_name) LIKE ?'
      params.push(`%${filters.sender}%`)
    }
    if (filters.source === 'story') {
      sql += " AND m.chat_id = 'status@broadcast'"
    } else if (filters.source === 'chat') {
      sql += " AND m.chat_id != 'status@broadcast'"
    }
    if (filters.after) {
      sql += ' AND m.timestamp > ?'
      params.push(filters.after)
    }
    if (filters.before) {
      sql += ' AND m.timestamp < ?'
      params.push(filters.before)
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(Math.min(filters.limit ?? 20, 100))

    const messages = this.db.prepare(sql).all(...params).map(this.rowToMessageWithResolvedNames)
    return this.attachReactions(messages)
  }

  // ─── Encryption helpers ─────────────────────────────────────────────────────
  // Protects api_key and webhook_secret columns at rest. The threat model is
  // DB file exfiltration without env vars (e.g. backup leak, volume export).

  encryptField(value: string): string {
    if (!this.derivedKey) return value
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', this.derivedKey, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('hex')
  }

  decryptField(value: string): string {
    if (!this.derivedKey) return value
    const [ivHex, encHex] = value.split(':')
    if (!ivHex || !encHex) return value // not encrypted, return as-is
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.derivedKey, iv)
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

  getDeliveries(filters: { appId?: string; status?: string; after?: number; before?: number; limit?: number } = {}) {
    let sql = 'SELECT * FROM webhook_deliveries WHERE 1=1'
    const params: any[] = []

    if (filters.appId) { sql += ' AND app_id = ?'; params.push(filters.appId) }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status) }
    if (filters.after) { sql += ' AND created_at > ?'; params.push(filters.after) }
    if (filters.before) { sql += ' AND created_at < ?'; params.push(filters.before) }

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

  private rowToMessageWithResolvedNames(row: any): Message {
    // Don't resolve sender name from chats table for status@broadcast — it's not a person
    const senderName = row.sender_id === 'status@broadcast'
      ? (row.sender_name || '')
      : (row.resolved_sender_name || row.sender_name || '')
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName,
      content: row.content,
      type: row.type,
      mimeType: row.mime_type ?? undefined,
      timestamp: new Date(row.timestamp * 1000),
      isFromMe: !!row.is_from_me,
      isGroup: !!row.is_group,
      groupName: row.is_group ? (row.resolved_group_name || row.group_name || undefined) : undefined,
      replyTo: row.reply_to ?? undefined,
      editedAt: row.edited_at ? new Date(row.edited_at * 1000) : undefined,
    }
  }

  private rowToChat(row: any): Chat {
    return {
      id: row.id,
      name: row.resolved_name || row.name || '',
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
