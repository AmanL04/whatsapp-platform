import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import type { WAAdapter } from '../../core/adapter'
import type { Chat, Message, MessageQuery } from '../../core/types'
import { normalizeJid, isLid, isStatusBroadcast, resolveCanonicalJid, loadIdentityCache, updateIdentityCache } from '../../core/jid'
import { SQLiteStore } from './store'

export class BaileysAdapter implements WAAdapter {
  private sock: WASocket | null = null
  private authDir: string
  private store: SQLiteStore
  private chatNames: Map<string, string> = new Map()
  private groupSyncDone = false
  private dispatchEvent?: (event: string, payload: unknown, chatId: string, isGroup: boolean) => void
  private messageHandlers: ((msg: Message) => void)[] = []
  private connectedHandlers: (() => void)[] = []
  private disconnectedHandlers: ((reason: string) => void)[] = []

  constructor(authDir = './data/auth', dbPath = './data/whatsapp.db', dbEncryptionKey?: string) {
    this.authDir = authDir
    this.store = new SQLiteStore(dbPath, dbEncryptionKey)
    // Load identity cache from DB
    loadIdentityCache(this.store.loadAllIdentities())
  }

  getStore(): SQLiteStore {
    return this.store
  }

  setEventDispatcher(fn: (event: string, payload: unknown, chatId: string, isGroup: boolean) => void) {
    this.dispatchEvent = fn
  }

  /** Returns the connected WhatsApp JID (e.g. for OTP sending), normalized */
  getOwnJid(): string | null {
    const jid = this.sock?.user?.id
    return jid ? normalizeJid(jid) : null
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    const { version } = await fetchLatestBaileysVersion()

    this.sock = makeWASocket({
      version,
      auth: state,
      syncFullHistory: true,
    })

    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`
        console.log('[baileys] scan QR code to connect:')
        console.log(`[baileys] QR URL: ${qrUrl}`)
        qrcode.generate(qr, { small: true })
      }
      if (connection === 'open') {
        console.log('[baileys] connected')
        this.connectedHandlers.forEach(h => h())
        // Only sync group identities once per server lifetime (not on reconnects)
        if (!this.groupSyncDone) {
          this.groupSyncDone = true
          this.syncGroupMemberNames()
        }
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode
        const reason = DisconnectReason[code] ?? 'unknown'
        this.disconnectedHandlers.forEach(h => h(reason))
        if (code !== DisconnectReason.loggedOut) {
          console.log('[baileys] reconnecting...')
          this.connect()
        }
      }
    })

    // Track chat/group names from Baileys sync
    this.sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (chat.id && chat.name) {
          this.chatNames.set(chat.id, chat.name)
          this.store.upsertChat(chat.id, chat.name, chat.id.endsWith('@g.us'))
          this.dispatchEvent?.('chat.updated', { id: chat.id, name: chat.name }, chat.id, chat.id.endsWith('@g.us'))
        }
      }
    })

    this.sock.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        if (update.id && update.name) {
          this.chatNames.set(update.id, update.name)
          this.store.upsertChat(update.id, update.name, update.id.endsWith('@g.us'))
          this.dispatchEvent?.('chat.updated', { id: update.id, name: update.name }, update.id, update.id.endsWith('@g.us'))
        }
      }
    })

    // Track contact names for DMs
    this.sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        const name = contact.notify || contact.verifiedName || contact.name || ''
        if (contact.id && name) {
          this.chatNames.set(contact.id, name)
          if (!contact.id.endsWith('@g.us')) {
            this.store.upsertChat(contact.id, name, false)
          }
        }
      }
    })

    this.sock.ev.on('contacts.update', (updates) => {
      for (const contact of updates) {
        const name = contact.notify || contact.verifiedName || contact.name || ''
        if (contact.id && name) {
          this.chatNames.set(contact.id, name)
          if (!contact.id.endsWith('@g.us')) {
            this.store.upsertChat(contact.id, name, false)
          }
        }
      }
    })

    this.sock.ev.on('groups.upsert', (groups) => {
      for (const group of groups) {
        if (group.id && group.subject) {
          this.chatNames.set(group.id, group.subject)
          this.store.upsertChat(group.id, group.subject, true)
        }
      }
    })

    // LID↔phone mappings from WhatsApp (most reliable source)
    this.sock.ev.on('lid-mapping.update' as any, (mappings: any) => {
      if (!mappings || !Array.isArray(mappings)) return
      console.log(`[baileys] lid-mapping.update: ${mappings.length} mappings`)
      for (const m of mappings) {
        if (m.lid && m.pn) {
          const lid = normalizeJid(m.lid)
          const phone = normalizeJid(m.pn)
          this.store.upsertIdentity(phone, lid, '', '')
          this.store.upsertIdentity(phone, phone, '', '')
          updateIdentityCache(lid, phone)
          updateIdentityCache(phone, phone)
          // Deferred cascade — normalize old messages in background
          setTimeout(() => this.cascadeNormalize(lid, phone), 100)
        }
      }
    })

    // History sync — captures messages sent from other linked devices (Beeper, WhatsApp Web)
    this.sock.ev.on('messaging-history.set', ({ messages: historyMsgs, chats: historyChats }) => {
      console.log(`[baileys] history sync: ${historyMsgs.length} messages, ${historyChats.length} chats`)

      // Store chat names in a transaction
      this.store.runInTransaction(() => {
        for (const chat of historyChats) {
          if (chat.id && chat.name) {
            this.chatNames.set(chat.id, chat.name)
            this.store.upsertChat(chat.id, chat.name, chat.id.endsWith('@g.us'))
          }
        }
      })

      // Normalize messages + extract media metadata
      const normalized: Message[] = []
      const rawJsons: string[] = []
      for (const raw of historyMsgs) {
        if (!raw.message) continue
        const msg = this.normaliseMessage(raw)
        if (!msg) continue
        msg.groupName = msg.isGroup ? this.chatNames.get(msg.chatId) : undefined
        normalized.push(msg)
        rawJsons.push(JSON.stringify(raw))
      }

      // Store in chunks of 200, yielding to event loop between chunks
      // so Express can respond to health checks
      this.storeHistoryBatch(normalized, rawJsons).then(() => {
        this.dispatchHistoryBatch(normalized)
      })
    })

    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const raw of messages) {
        if (!raw.message) continue
        const msg = this.normaliseMessage(raw)
        if (!msg) continue

        // Resolve group name if missing, then persist + dispatch
        this.resolveGroupName(msg).then(() => {
          this.store.upsertMessage(msg, JSON.stringify(raw))

          // Update sender name in chats table from pushName (replaces phone number fallback over time)
          if (msg.senderName && msg.senderId && msg.senderId !== msg.chatId) {
            this.chatNames.set(msg.senderId, msg.senderName)
            this.store.upsertChat(msg.senderId, msg.senderName, false)
          }

          this.messageHandlers.forEach(h => h(msg))

          // Dispatch to external apps
          const eventName = msg.isFromMe ? 'message.sent' : 'message.received'
          this.dispatchEvent?.(eventName, msg, msg.chatId, msg.isGroup)

          if (msg.type !== 'text') {
            this.dispatchEvent?.('media.received', msg, msg.chatId, msg.isGroup)
          }
        })
      }
    })
  }

  disconnect(): Promise<void> {
    this.sock?.end(undefined)
    this.sock = null
    return Promise.resolve()
  }

  isConnected(): boolean {
    return this.sock !== null
  }

  async getChats(opts?: { after?: number; before?: number; limit?: number }): Promise<Chat[]> {
    return this.store.getChats(opts)
  }

  async getMessages(query: MessageQuery): Promise<Message[]> {
    return this.store.getMessages(query)
  }

  async searchMessages(text: string, opts?: { after?: number; before?: number; limit?: number }): Promise<Message[]> {
    return this.store.searchMessages(text, opts)
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.sock) throw new Error('not connected')
    await this.sock.sendMessage(chatId, { text: content })
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const rawJson = this.store.getRawJson(mediaId)
    if (!rawJson) throw new Error(`no raw message found for media ${mediaId}`)

    const raw = JSON.parse(rawJson)
    const buffer = await downloadMediaMessage(raw, 'buffer', {})
    return buffer as Buffer
  }

  onMessage(handler: (msg: Message) => void) { this.messageHandlers.push(handler) }
  onMedia(_handler: (media: Message) => void) { /* Media events dispatched via onMessage — type != 'text' */ }
  onConnected(handler: () => void) { this.connectedHandlers.push(handler) }
  onDisconnected(handler: (reason: string) => void) { this.disconnectedHandlers.push(handler) }

  // ─── Deferred cascade normalization ─────────────────────────────────────────

  private cascadeNormalize(oldJid: string, canonicalJid: string) {
    if (oldJid === canonicalJid) return
    try {
      const chatResult = this.store.getDb().prepare('UPDATE messages SET chat_id = ? WHERE chat_id = ?').run(canonicalJid, oldJid)
      const senderResult = this.store.getDb().prepare('UPDATE messages SET sender_id = ? WHERE sender_id = ?').run(canonicalJid, oldJid)
      if (chatResult.changes > 0 || senderResult.changes > 0) {
        console.log(`[identity] cascade: ${oldJid} → ${canonicalJid} (${chatResult.changes} chat_ids, ${senderResult.changes} sender_ids)`)
      }
      // Merge chat entries
      const oldChat = this.store.getDb().prepare('SELECT last_message_at FROM chats WHERE id = ?').get(oldJid) as { last_message_at: number } | undefined
      if (oldChat) {
        this.store.getDb().prepare('DELETE FROM chats WHERE id = ?').run(oldJid)
      }
    } catch { /* non-critical — old data stays, queries still work via JOIN */ }
  }

  private async deferredCascade(mappings: { lid: string; phoneJid: string }[]) {
    // Wait 5s after connect before starting
    await new Promise(resolve => setTimeout(resolve, 5000))
    const BATCH = 50
    for (let i = 0; i < mappings.length; i += BATCH) {
      const batch = mappings.slice(i, i + BATCH)
      for (const { lid, phoneJid } of batch) {
        this.cascadeNormalize(lid, phoneJid)
      }
      // Yield to event loop between batches
      if (i + BATCH < mappings.length) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
  }

  // ─── History sync batched storage + dispatch ───────────────────────────────

  private async storeHistoryBatch(messages: Message[], rawJsons: string[]) {
    const CHUNK = 200
    for (let i = 0; i < messages.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, messages.length)
      this.store.runInTransaction(() => {
        for (let j = i; j < end; j++) {
          this.store.upsertMessage(messages[j], rawJsons[j])
        }
      })
      // Yield to event loop so Express can serve health checks
      if (i + CHUNK < messages.length) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  // ─── Group member name sync ─────────────────────────────────────────────────

  private async syncGroupMemberNames() {
    if (!this.sock) return
    try {
      const chats = this.store.getChats({ limit: 500 })
      const groups = chats.filter(c => c.isGroup && c.id.endsWith('@g.us'))

      console.log(`[baileys] syncing member identities for ${groups.length} groups`)

      // Fetch all group metadata
      const allMappings: { lid: string; phoneJid: string }[] = []
      for (const group of groups) {
        try {
          const metadata = await this.sock!.groupMetadata(group.id)
          for (const p of metadata.participants) {
            const lid = p.lid || (p.id?.endsWith('@lid') ? p.id : null)
            const jid = p.jid
            if (lid && jid) allMappings.push({ lid, phoneJid: jid })
          }
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch { /* skip */ }
      }

      console.log(`[baileys] built ${allMappings.length} LID→phone mappings`)

      // Persist to identities table + update cache
      let named = 0
      this.store.runInTransaction(() => {
        for (const { lid, phoneJid } of allMappings) {
          const phone = phoneJid.replace('@s.whatsapp.net', '')
          const existingName = this.chatNames.get(phoneJid) || this.chatNames.get(lid) || ''
          const name = existingName || phone
          const nameSource = existingName ? 'contact' : 'phone'

          // Create identity entries: lid → phoneJid (canonical)
          this.store.upsertIdentity(phoneJid, lid, name, nameSource)
          this.store.upsertIdentity(phoneJid, phoneJid, name, nameSource)
          updateIdentityCache(lid, phoneJid)
          updateIdentityCache(phoneJid, phoneJid)
          this.chatNames.set(lid, name)

          if (existingName) named++
        }
      })

      // Deferred: normalize old messages in small batches, yielding between each
      this.deferredCascade(allMappings)

      console.log(`[baileys] synced ${named} named + ${allMappings.length - named} phone-number identities`)
    } catch (err) {
      console.error('[baileys] group member sync failed:', err)
    }
  }

  // ─── History sync batched dispatch ──────────────────────────────────────────

  private async dispatchHistoryBatch(messages: Message[]) {
    if (!this.dispatchEvent || messages.length === 0) return

    const BATCH_SIZE = 50
    const BATCH_DELAY_MS = 100

    console.log(`[baileys] dispatching ${messages.length} history messages in batches of ${BATCH_SIZE}`)
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE)
      for (const msg of batch) {
        const eventName = msg.isFromMe ? 'message.sent' : 'message.received'
        this.dispatchEvent(eventName, msg, msg.chatId, msg.isGroup)
      }
      if (i + BATCH_SIZE < messages.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }
  }

  // ─── Group name resolution ─────────────────────────────────────────────────

  private async resolveGroupName(msg: Message): Promise<void> {
    if (!msg.isGroup || msg.groupName) return
    if (!this.sock) return

    // Check cache first
    const cached = this.chatNames.get(msg.chatId)
    if (cached) {
      msg.groupName = cached
      return
    }

    // Fetch from WhatsApp
    try {
      const metadata = await this.sock.groupMetadata(msg.chatId)
      if (metadata.subject) {
        this.chatNames.set(msg.chatId, metadata.subject)
        this.store.upsertChat(msg.chatId, metadata.subject, true)
        msg.groupName = metadata.subject
      }
    } catch (err) {
      // Silently fail — name stays undefined
    }
  }

  // ─── Normalisation helpers ────────────────────────────────────────────────

  private normaliseMessage(raw: any): Message | null {
    const msg = raw.message
    if (!msg) return null

    // Skip protocol/system messages that have no user content
    if (msg.protocolMessage || msg.senderKeyDistributionMessage || msg.reactionMessage) {
      return null
    }

    const content =
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      ''
    const type = this.resolveType(msg)

    // Skip text messages with no actual content (e.g. empty system notifications)
    if (type === 'text' && !content) return null

    // Resolve to canonical JIDs
    const rawChatId = normalizeJid(raw.key.remoteJid ?? '')
    const chatId = resolveCanonicalJid(rawChatId)
    const isGroup = chatId.endsWith('@g.us')
    const groupName = isGroup ? this.chatNames.get(chatId) : undefined

    const mimeType = type !== 'text'
      ? (msg[`${type}Message`]?.mimetype ?? undefined)
      : undefined

    const rawSenderId = normalizeJid(raw.key.participant ?? raw.participant ?? rawChatId)
    const senderId = resolveCanonicalJid(rawSenderId)
    const senderName = raw.pushName || this.store.resolveDisplayName(senderId) || this.chatNames.get(senderId) || ''

    // Discover LID→phone mappings from DM context
    if (isLid(rawChatId) && !isLid(chatId) && rawChatId !== chatId) {
      // rawChatId was LID, resolved to phone — save the mapping
      this.store.upsertIdentity(chatId, rawChatId, raw.pushName || '', raw.pushName ? 'pushName' : '')
      updateIdentityCache(rawChatId, chatId)
    }

    // Persist pushName to identities
    if (raw.pushName && senderId) {
      const nameSource = 'pushName'
      this.store.upsertIdentity(senderId, senderId, raw.pushName, nameSource)
      if (rawSenderId !== senderId) {
        this.store.upsertIdentity(senderId, rawSenderId, raw.pushName, nameSource)
      }
      // Update name across all aliases of this canonical
      this.store.updateIdentityName(senderId, raw.pushName, nameSource)
      this.chatNames.set(senderId, raw.pushName)
    }

    // verifiedBizName as fallback
    if (raw.verifiedBizName && !raw.pushName && senderId) {
      this.store.upsertIdentity(senderId, senderId, raw.verifiedBizName, 'verifiedBizName')
    }

    return {
      id: raw.key.id ?? '',
      chatId,
      senderId,
      senderName,
      content,
      type,
      mimeType,
      timestamp: new Date((raw.messageTimestamp as number) * 1000),
      isFromMe: raw.key.fromMe ?? false,
      isGroup,
      groupName,
    }
  }

  private resolveType(message: any): Message['type'] {
    if (!message) return 'text'
    if (message.imageMessage) return 'image'
    if (message.videoMessage) return 'video'
    if (message.audioMessage) return 'audio'
    if (message.documentMessage) return 'document'
    if (message.stickerMessage) return 'sticker'
    return 'text'
  }
}
