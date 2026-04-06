import type { Chat, Message, MessageQuery } from './types'

/**
 * WAAdapter — the contract every connection layer must implement.
 * Apps talk to this interface only. Never import from adapters/ directly.
 */
export interface WAAdapter {
  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Read
  getChats(opts?: { after?: number; before?: number; limit?: number }): Promise<Chat[]>
  getMessages(query: MessageQuery): Promise<Message[]>
  searchMessages(text: string, opts?: { after?: number; before?: number; limit?: number }): Promise<Message[]>

  // Write
  sendMessage(chatId: string, content: string): Promise<void>

  // Media — downloads on demand from WhatsApp via raw_json
  downloadMedia(mediaId: string): Promise<Buffer>

  // Events
  onMessage(handler: (msg: Message) => void): void
  onMedia(handler: (media: Message) => void): void
  onConnected(handler: () => void): void
  onDisconnected(handler: (reason: string) => void): void
}
