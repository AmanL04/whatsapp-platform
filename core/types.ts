export interface Message {
  id: string
  chatId: string
  senderId: string
  senderName: string
  content: string
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker'
  mimeType?: string
  timestamp: Date
  isFromMe: boolean
  isGroup: boolean
  groupName?: string
  replyTo?: string
  reactions?: { emoji: string; senderId: string }[]
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
  before?: Date    // cursor: get messages before this timestamp
  limit?: number
  search?: string
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
