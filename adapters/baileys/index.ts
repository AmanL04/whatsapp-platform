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
import type { Chat, Message, Media, MessageQuery } from '../../core/types'
import { SQLiteStore } from './store'

export class BaileysAdapter implements WAAdapter {
  private sock: WASocket | null = null
  private authDir: string
  private store: SQLiteStore
  private chatNames: Map<string, string> = new Map()
  private dispatchEvent?: (event: string, payload: unknown, chatId: string, isGroup: boolean) => void
  private messageHandlers: ((msg: Message) => void)[] = []
  private mediaHandlers: ((media: Media) => void)[] = []
  private connectedHandlers: (() => void)[] = []
  private disconnectedHandlers: ((reason: string) => void)[] = []

  constructor(authDir = './data/auth', dbPath = './data/whatsapp.db', dbEncryptionKey?: string) {
    this.authDir = authDir
    this.store = new SQLiteStore(dbPath, dbEncryptionKey)
  }

  getStore(): SQLiteStore {
    return this.store
  }

  setEventDispatcher(fn: (event: string, payload: unknown, chatId: string, isGroup: boolean) => void) {
    this.dispatchEvent = fn
  }

  /** Returns the connected WhatsApp JID (e.g. for OTP sending) */
  getOwnJid(): string | null {
    return this.sock?.user?.id ?? null
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
        console.log('[baileys] scan QR code to connect:')
        qrcode.generate(qr, { small: true })
      }
      if (connection === 'open') {
        console.log('[baileys] connected')
        this.connectedHandlers.forEach(h => h())
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

    // History sync — captures messages sent from other linked devices (Beeper, WhatsApp Web)
    this.sock.ev.on('messaging-history.set', ({ messages: historyMsgs, chats: historyChats }) => {
      console.log(`[baileys] history sync: ${historyMsgs.length} messages, ${historyChats.length} chats`)

      // Store chat names from history
      for (const chat of historyChats) {
        if (chat.id && chat.name) {
          this.chatNames.set(chat.id, chat.name)
          this.store.upsertChat(chat.id, chat.name, chat.id.endsWith('@g.us'))
        }
      }

      // Store messages from history and dispatch in batches
      const normalized: Message[] = []
      for (const raw of historyMsgs) {
        if (!raw.message) continue
        const msg = this.normaliseMessage(raw)
        if (!msg) continue
        msg.groupName = msg.isGroup ? this.chatNames.get(msg.chatId) : undefined
        this.store.upsertMessage(msg, JSON.stringify(raw))
        normalized.push(msg)
      }

      // Batched dispatch — 50 messages at a time with 100ms gaps
      this.dispatchHistoryBatch(normalized)
    })

    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const raw of messages) {
        if (!raw.message) continue
        const msg = this.normaliseMessage(raw)
        if (!msg) continue

        // Resolve group name if missing, then persist + dispatch
        this.resolveGroupName(msg).then(() => {
          this.store.upsertMessage(msg, JSON.stringify(raw))
          this.messageHandlers.forEach(h => h(msg))

          // Dispatch to external apps
          const eventName = msg.isFromMe ? 'message.sent' : 'message.received'
          this.dispatchEvent?.(eventName, msg, msg.chatId, msg.isGroup)

          if (msg.type !== 'text') {
            const media = this.normaliseMedia(raw, msg)
            if (media) {
              this.store.upsertMedia(media)
              this.mediaHandlers.forEach(h => h(media))
              this.dispatchEvent?.('media.received', media, msg.chatId, msg.isGroup)
            }
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

  async getChats(): Promise<Chat[]> {
    return this.store.getChats()
  }

  async getMessages(query: MessageQuery): Promise<Message[]> {
    return this.store.getMessages(query)
  }

  async searchMessages(text: string): Promise<Message[]> {
    return this.store.searchMessages(text)
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
  onMedia(handler: (media: Media) => void) { this.mediaHandlers.push(handler) }
  onConnected(handler: () => void) { this.connectedHandlers.push(handler) }
  onDisconnected(handler: (reason: string) => void) { this.disconnectedHandlers.push(handler) }

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

    const chatId = raw.key.remoteJid ?? ''
    const isGroup = chatId.endsWith('@g.us')
    const groupName = isGroup ? this.chatNames.get(chatId) : undefined
    return {
      id: raw.key.id ?? '',
      chatId,
      senderId: raw.key.participant ?? chatId,
      senderName: raw.pushName ?? '',
      content,
      type,
      timestamp: new Date((raw.messageTimestamp as number) * 1000),
      isFromMe: raw.key.fromMe ?? false,
      isGroup,
      groupName,
    }
  }

  private normaliseMedia(raw: any, msg: Message): Media | null {
    if (msg.type === 'text') return null
    return {
      id: msg.id,
      chatId: msg.chatId,
      type: msg.type as Media['type'],
      mimeType: raw.message?.[`${msg.type}Message`]?.mimetype ?? '',
      caption: msg.content || undefined,
      timestamp: msg.timestamp,
      senderName: msg.senderName,
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
