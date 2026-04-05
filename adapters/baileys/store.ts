import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import type { Chat, Message, Media, MessageQuery } from '../../core/types'

export class SQLiteStore {
  private db: Database.Database

  constructor(dbPath = './data/whatsapp.db') {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
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

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        chat_id TEXT,
        from_name TEXT,
        content TEXT,
        confidence TEXT,
        score INTEGER,
        created_at INTEGER,
        done INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        type TEXT,
        local_path TEXT,
        mime_type TEXT,
        caption TEXT,
        timestamp INTEGER,
        sender_name TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
    `)
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  upsertMessage(msg: Message, rawJson?: string) {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages
        (id, chat_id, sender_id, sender_name, content, type, timestamp, is_from_me, is_group, group_name, reply_to, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.chatId,
      msg.senderId,
      msg.senderName,
      msg.content,
      msg.type,
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
    let sql = 'SELECT * FROM messages WHERE 1=1'
    const params: any[] = []

    if (query.chatId) {
      sql += ' AND chat_id = ?'
      params.push(query.chatId)
    }
    if (query.since) {
      sql += ' AND timestamp >= ?'
      params.push(Math.floor(query.since.getTime() / 1000))
    }
    if (query.search) {
      sql += ' AND content LIKE ?'
      params.push(`%${query.search}%`)
    }

    sql += ' ORDER BY timestamp DESC'

    if (query.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    return this.db.prepare(sql).all(...params).map(this.rowToMessage)
  }

  searchMessages(text: string): Message[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE content LIKE ? ORDER BY timestamp DESC LIMIT 100'
    ).all(`%${text}%`).map(this.rowToMessage)
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

  getChats(): Chat[] {
    return this.db.prepare(
      'SELECT * FROM chats ORDER BY last_message_at DESC'
    ).all().map(this.rowToChat)
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  insertTask(task: {
    messageId: string
    chatId: string
    fromName: string
    content: string
    confidence: string
    score: number
  }) {
    this.db.prepare(`
      INSERT INTO tasks (message_id, chat_id, from_name, content, confidence, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(task.messageId, task.chatId, task.fromName, task.content, task.confidence, task.score, Math.floor(Date.now() / 1000))
  }

  getTasks(includeDone = false) {
    const sql = includeDone
      ? 'SELECT * FROM tasks ORDER BY created_at DESC'
      : 'SELECT * FROM tasks WHERE done = 0 ORDER BY created_at DESC'
    return this.db.prepare(sql).all()
  }

  markTaskDone(id: number) {
    this.db.prepare('UPDATE tasks SET done = 1 WHERE id = ?').run(id)
  }

  // ─── Media ─────────────────────────────────────────────────────────────────

  upsertMedia(media: Media) {
    this.db.prepare(`
      INSERT OR REPLACE INTO media (id, chat_id, type, local_path, mime_type, caption, timestamp, sender_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      media.id,
      media.chatId,
      media.type,
      media.localPath ?? null,
      media.mimeType,
      media.caption ?? null,
      Math.floor(media.timestamp.getTime() / 1000),
      media.senderName,
    )
  }

  getMedia(limit = 50) {
    return this.db.prepare('SELECT * FROM media ORDER BY timestamp DESC LIMIT ?').all(limit)
  }

  // ─── Summaries (simple key-value for plugin output) ────────────────────────

  // We'll store daily summaries in a simple table
  ensureSummariesTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        created_at INTEGER
      )
    `)
  }

  insertSummary(content: string) {
    this.ensureSummariesTable()
    this.db.prepare('INSERT INTO summaries (content, created_at) VALUES (?, ?)').run(content, Math.floor(Date.now() / 1000))
  }

  getSummaries(limit = 10) {
    this.ensureSummariesTable()
    return this.db.prepare('SELECT * FROM summaries ORDER BY created_at DESC LIMIT ?').all(limit)
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
      timestamp: new Date(row.timestamp * 1000),
      isFromMe: !!row.is_from_me,
      isGroup: !!row.is_group,
      groupName: row.group_name ?? undefined,
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

  close() {
    this.db.close()
  }
}
