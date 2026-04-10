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
import { normalizeJid, isLid, resolveCanonicalJid, loadIdentityCache, updateIdentityCache } from '../../core/jid'
import { SQLiteStore } from './store'

export class BaileysAdapter implements WAAdapter {
  private sock: WASocket | null = null
  private authDir: string
  private store: SQLiteStore
  private chatNames: Map<string, string> = new Map()
  private groupCache: Map<string, { subject: string; participants: any[] }> = new Map()
  private dispatchEvent?: (event: string, payload: unknown, chatId: string, isGroup: boolean) => void
  private messageHandlers: ((msg: Message) => void)[] = []
  private connectedHandlers: (() => void)[] = []
  private disconnectedHandlers: ((reason: string) => void)[] = []

  constructor(authDir = './data/auth', dbPath = './data/whatsapp.db', dbEncryptionKey?: string) {
    this.authDir = authDir
    this.store = new SQLiteStore(dbPath, dbEncryptionKey)
    // Load caches from DB
    loadIdentityCache(this.store.loadAllIdentities())
    this.loadGroupCacheFromDb()
  }

  private loadGroupCacheFromDb() {
    const groups = this.store.loadAllGroupMetadata()
    for (const [jid, meta] of groups) {
      this.groupCache.set(jid, meta)
      this.chatNames.set(jid, meta.subject)
    }
    if (groups.size > 0) {
      console.log(`[store] loaded ${groups.size} group metadata entries from DB`)
    }
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
      cachedGroupMetadata: async (jid) => {
        const cached = this.groupCache.get(jid)
        if (!cached) return undefined
        return { id: jid, subject: cached.subject, participants: cached.participants } as any
      },
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
        // Refresh stale group metadata in background (only fetches groups older than 24h)
        this.refreshStaleGroups()
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

    // Track chat/group names + unread counts from Baileys sync
    this.sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        const chatId = resolveCanonicalJid(normalizeJid(chat.id))
        if (!chatId) continue
        if (chat.name) {
          this.chatNames.set(chatId, chat.name)
          this.store.upsertChat(chatId, chat.name, chatId.endsWith('@g.us'))
          this.dispatchEvent?.('chat.updated', { id: chatId, name: chat.name }, chatId, chatId.endsWith('@g.us'))
        }
        if (typeof chat.unreadCount === 'number') {
          this.store.updateUnreadCount(chatId, chat.unreadCount)
        }
      }
    })

    this.sock.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        const chatId = resolveCanonicalJid(normalizeJid(update.id))
        if (!chatId) continue
        if (update.name) {
          this.chatNames.set(chatId, update.name)
          this.store.upsertChat(chatId, update.name, chatId.endsWith('@g.us'))
          this.dispatchEvent?.('chat.updated', { id: chatId, name: update.name }, chatId, chatId.endsWith('@g.us'))
        }
        if (typeof update.unreadCount === 'number') {
          this.store.updateUnreadCount(chatId, update.unreadCount)
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
          // Persist full metadata if participants available
          if (group.participants) {
            this.groupCache.set(group.id, { subject: group.subject, participants: group.participants })
            this.store.updateGroupMetadata(group.id, group.subject, group.participants)
          }
        }
      }
    })

    this.sock.ev.on('group-participants.update', async ({ id }) => {
      // Refresh full metadata on member changes — the event only tells us who changed, not the full list
      if (!this.sock) return
      try {
        const metadata = await this.sock.groupMetadata(id)
        this.groupCache.set(id, { subject: metadata.subject, participants: metadata.participants })
        this.store.updateGroupMetadata(id, metadata.subject, metadata.participants)
        this.extractIdentitiesFromParticipants(metadata.participants)
      } catch { /* non-critical */ }
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

      // Store chat names + unread counts in a transaction
      this.store.runInTransaction(() => {
        for (const chat of historyChats) {
          const chatId = resolveCanonicalJid(normalizeJid(chat.id))
          if (!chatId) continue
          if (chat.name) {
            this.chatNames.set(chatId, chat.name)
            this.store.upsertChat(chatId, chat.name, chatId.endsWith('@g.us'))
          }
          if (typeof chat.unreadCount === 'number' && chat.unreadCount >= 0) {
            this.store.updateUnreadCount(chatId, chat.unreadCount)
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

          // Attach sentByAppId if this message was sent via the API
          const sentByAppId = this.store.getSentByAppId(msg.id)
          if (sentByAppId) msg.sentByAppId = sentByAppId

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

    // Reaction events — add/remove emoji reactions on messages
    this.sock.ev.on('messages.reaction', (reactions) => {
      for (const { key, reaction } of reactions) {
        const messageId = key.id
        if (!messageId) continue

        const chatId = resolveCanonicalJid(normalizeJid(key.remoteJid ?? ''))
        const isGroup = chatId.endsWith('@g.us')
        const rawSenderId = normalizeJid(reaction.key?.participant ?? key.participant ?? '')
        const senderId = resolveCanonicalJid(rawSenderId)
        const senderName = this.store.resolveDisplayName(senderId) || this.chatNames.get(senderId) || ''
        const emoji = reaction.text ?? ''

        if (emoji) {
          this.store.upsertReaction(messageId, senderId, emoji)
        } else {
          this.store.deleteReaction(messageId, senderId)
        }

        this.dispatchEvent?.('message.reaction', {
          messageId,
          chatId,
          senderId,
          senderName,
          emoji: emoji || null,
          action: emoji ? 'add' : 'remove',
        }, chatId, isGroup)
      }
    })

    // Edit events — update content when a message is edited
    this.sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        const editedMsg = (update as any).message?.editedMessage?.message
        if (!editedMsg) continue

        const originalMessageId = key.id
        if (!originalMessageId) continue

        const newContent = this.extractContent(editedMsg)

        const chatId = resolveCanonicalJid(normalizeJid(key.remoteJid ?? ''))
        const isGroup = chatId.endsWith('@g.us')
        const editTimestamp = (update as any).messageTimestamp
          ?? Math.floor(Date.now() / 1000)

        const { oldContent, found } = this.store.editMessage(originalMessageId, newContent, editTimestamp)
        if (!found) continue

        const rawSenderId = normalizeJid(
          key.participant ?? (key.fromMe ? this.sock?.user?.id : '') ?? ''
        )
        const senderId = rawSenderId ? resolveCanonicalJid(rawSenderId) : ''
        const senderName = senderId
          ? (this.store.resolveDisplayName(senderId) || this.chatNames.get(senderId) || '')
          : ''

        this.dispatchEvent?.('message.edited', {
          messageId: originalMessageId,
          chatId,
          senderId,
          senderName,
          oldContent,
          newContent,
          editedAt: new Date(editTimestamp * 1000).toISOString(),
        }, chatId, isGroup)
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

  async sendMessage(chatId: string, content: string): Promise<string> {
    if (!this.sock) throw new Error('not connected')
    try {
      const sent = await this.sock.sendMessage(chatId, { text: content })
      return sent?.key?.id ?? ''
    } catch (err) {
      // If group send fails (stale cached participants), evict cache and retry once
      if (chatId.endsWith('@g.us') && this.groupCache.has(chatId)) {
        console.log(`[baileys] group send failed, evicting stale cache for ${chatId} and retrying`)
        this.groupCache.delete(chatId)
        const sent = await this.sock.sendMessage(chatId, { text: content })
        try {
          const metadata = await this.sock!.groupMetadata(chatId)
          this.groupCache.set(chatId, { subject: metadata.subject, participants: metadata.participants })
          this.store.updateGroupMetadata(chatId, metadata.subject, metadata.participants)
        } catch { /* non-critical */ }
        return sent?.key?.id ?? ''
      }
      throw err
    }
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const rawJson = this.store.getRawJson(mediaId)
    if (!rawJson) throw new Error(`no raw message found for media ${mediaId}`)

    const raw = JSON.parse(rawJson)
    const buffer = await downloadMediaMessage(raw, 'buffer', {})
    return buffer as Buffer
  }

  onMessage(handler: (msg: Message) => void) { this.messageHandlers.push(handler) }
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

  // ─── Group metadata refresh ─────────────────────────────────────────────────

  private async refreshStaleGroups() {
    if (!this.sock) return
    try {
      const staleJids = this.store.getStaleGroups(24 * 60 * 60) // older than 24h
      if (staleJids.length === 0) {
        console.log(`[baileys] all ${this.groupCache.size} groups fresh — skipping metadata refresh`)
        return
      }

      console.log(`[baileys] refreshing metadata for ${staleJids.length} stale groups (${this.groupCache.size} cached)`)

      const allMappings: { lid: string; phoneJid: string }[] = []
      for (const jid of staleJids) {
        try {
          const metadata = await this.sock!.groupMetadata(jid)
          this.groupCache.set(jid, { subject: metadata.subject, participants: metadata.participants })
          this.chatNames.set(jid, metadata.subject)
          this.store.updateGroupMetadata(jid, metadata.subject, metadata.participants)

          for (const p of metadata.participants) {
            const lid = p.lid || (p.id?.endsWith('@lid') ? p.id : null)
            const pJid = p.jid
            if (lid && pJid) allMappings.push({ lid, phoneJid: pJid })
          }
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch { /* skip */ }
      }

      // Persist identity mappings
      if (allMappings.length > 0) {
        this.extractIdentitiesFromMappings(allMappings)
        this.deferredCascade(allMappings)
      }

      console.log(`[baileys] refreshed ${staleJids.length} groups, ${allMappings.length} LID→phone mappings`)
    } catch (err) {
      console.error('[baileys] group metadata refresh failed:', err)
    }
  }

  private extractIdentitiesFromParticipants(participants: any[]) {
    const mappings: { lid: string; phoneJid: string }[] = []
    for (const p of participants) {
      const lid = p.lid || (p.id?.endsWith('@lid') ? p.id : null)
      const pJid = p.jid
      if (lid && pJid) mappings.push({ lid, phoneJid: pJid })
    }
    if (mappings.length > 0) this.extractIdentitiesFromMappings(mappings)
  }

  private extractIdentitiesFromMappings(mappings: { lid: string; phoneJid: string }[]) {
    let named = 0
    this.store.runInTransaction(() => {
      for (const { lid, phoneJid } of mappings) {
        const phone = phoneJid.replace('@s.whatsapp.net', '')
        const existingName = this.chatNames.get(phoneJid) || this.chatNames.get(lid) || ''
        const name = existingName || phone
        const nameSource = existingName ? 'contact' : 'phone'

        this.store.upsertIdentity(phoneJid, lid, name, nameSource)
        this.store.upsertIdentity(phoneJid, phoneJid, name, nameSource)
        updateIdentityCache(lid, phoneJid)
        updateIdentityCache(phoneJid, phoneJid)
        this.chatNames.set(lid, name)

        if (existingName) named++
      }
    })
    console.log(`[baileys] extracted ${named} named + ${mappings.length - named} phone-number identities`)
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

  // ─── Group name resolution (3-tier: memory → SQLite → API) ─────────────────

  private async resolveGroupName(msg: Message): Promise<void> {
    if (!msg.isGroup || msg.groupName) return

    // 1. In-memory cache
    const cached = this.groupCache.get(msg.chatId)
    if (cached) { msg.groupName = cached.subject; return }

    // 2. SQLite
    const stored = this.store.getGroupParticipants(msg.chatId)
    if (stored) {
      this.groupCache.set(msg.chatId, stored)
      this.chatNames.set(msg.chatId, stored.subject)
      msg.groupName = stored.subject
      return
    }

    // 3. API (last resort)
    if (!this.sock) return
    try {
      const metadata = await this.sock.groupMetadata(msg.chatId)
      this.groupCache.set(msg.chatId, { subject: metadata.subject, participants: metadata.participants })
      this.chatNames.set(msg.chatId, metadata.subject)
      this.store.upsertChat(msg.chatId, metadata.subject, true)
      this.store.updateGroupMetadata(msg.chatId, metadata.subject, metadata.participants)
      this.extractIdentitiesFromParticipants(metadata.participants)
      msg.groupName = metadata.subject
    } catch { /* silent */ }
  }

  // ─── Normalisation helpers ────────────────────────────────────────────────

  private normaliseMessage(raw: any): Message | null {
    const msg = raw.message
    if (!msg) return null

    // Skip protocol/system messages that have no user content
    if (msg.protocolMessage || msg.senderKeyDistributionMessage || msg.reactionMessage) {
      return null
    }

    const content = this.extractContent(msg)
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

    // In DMs, participant is absent. For fromMe DMs, remoteJid is the RECIPIENT,
    // not the sender — use our own JID to avoid attributing our pushName to the contact.
    const rawSenderId = normalizeJid(
      raw.key.participant ?? raw.participant ?? (raw.key.fromMe ? this.sock?.user?.id : rawChatId) ?? rawChatId
    )
    const senderId = resolveCanonicalJid(rawSenderId)
    const senderName = raw.pushName || this.store.resolveDisplayName(senderId) || this.chatNames.get(senderId) || ''

    // Discover LID→phone mappings from DM context
    if (isLid(rawChatId) && !isLid(chatId) && rawChatId !== chatId) {
      // rawChatId was LID, resolved to phone — save the mapping.
      // Only attribute pushName if NOT fromMe — pushName is the sender's name, not the contact's.
      const contactName = raw.key.fromMe ? '' : (raw.pushName || '')
      this.store.upsertIdentity(chatId, rawChatId, contactName, contactName ? 'pushName' : '')
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
      isFromMe: raw.key.fromMe || (senderId === this.getOwnJid()),
      isGroup,
      groupName,
    }
  }

  private extractContent(msg: any): string {
    return msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      ''
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
