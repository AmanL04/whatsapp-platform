export interface Message {
  id: string
  chatId: string
  senderId: string
  senderName: string
  content: string
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker'
  timestamp: Date
  isFromMe: boolean
  isGroup: boolean
  groupName?: string
  replyTo?: string
  reactions?: { emoji: string; senderId: string }[]
}

export interface Media {
  id: string
  chatId: string
  type: 'image' | 'video' | 'audio' | 'document'
  localPath?: string
  mimeType: string
  caption?: string
  timestamp: Date
  senderName: string
}

export interface Chat {
  id: string
  name: string
  isGroup: boolean
  lastMessageAt: Date
  unreadCount: number
  participants?: string[]
}

export interface MessageQuery {
  chatId?: string
  since?: Date
  limit?: number
  search?: string
}

/**
 * PluginContext — passed to every plugin run() call.
 * Uses a minimal adapter shape to avoid circular imports with adapter.ts.
 * TODO: Remove in Step 8 when plugins are deleted.
 */
export interface PluginContext {
  adapter: {
    getChats(): Promise<Chat[]>
    getMessages(query: MessageQuery): Promise<Message[]>
    searchMessages(text: string): Promise<Message[]>
    sendMessage(chatId: string, content: string): Promise<void>
    downloadMedia(mediaId: string): Promise<Buffer>
  }
  message?: Message
  media?: Media
  notify: (text: string) => void
  log: (msg: string) => void
}

// ─── App Registration Types ──────────────────────────────────────────────────

export type Permission =
  | 'messages.read'
  | 'chats.read'
  | 'media.read'
  | 'media.download'
  | 'messages.send'

export interface App {
  id: string
  name: string
  description: string
  webhookGlobalUrl: string
  webhookSecret: string
  webhookEvents: { name: string; url?: string }[]
  apiKey: string
  permissions: Permission[]
  scopeChatTypes: ('dm' | 'group')[]
  scopeSpecificChats: string[]
  active: boolean
  createdAt: Date
}
