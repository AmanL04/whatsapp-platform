import type { Chat, Message, Media, MessageQuery } from './types'

/**
 * WAAdapter — the contract every connection layer must implement.
 * Plugins talk to this interface only. Never import from adapters/ directly.
 */
export interface WAAdapter {
  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Read
  getChats(): Promise<Chat[]>
  getMessages(query: MessageQuery): Promise<Message[]>
  searchMessages(text: string): Promise<Message[]>

  // Write
  sendMessage(chatId: string, content: string): Promise<void>

  // Media
  downloadMedia(mediaId: string): Promise<Buffer>

  // Events — plugins subscribe to these
  onMessage(handler: (msg: Message) => void): void
  onMedia(handler: (media: Media) => void): void
  onConnected(handler: () => void): void
  onDisconnected(handler: (reason: string) => void): void
}
