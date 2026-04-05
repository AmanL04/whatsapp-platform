import type { App, Permission, Message, Chat, MessageQuery } from '../core/types'

/**
 * Check if an app has a specific permission.
 */
export function checkPermission(app: App, permission: Permission): boolean {
  return app.permissions.includes(permission)
}

/**
 * Check if a chat is within an app's scope.
 * Returns false if the chat type doesn't match or the chat isn't in the specific list.
 */
export function isChatInScope(app: App, chatId: string, isGroup: boolean): boolean {
  const chatType = isGroup ? 'group' : 'dm'
  if (!app.scopeChatTypes.includes(chatType)) return false
  if (app.scopeSpecificChats.length > 0 && !app.scopeSpecificChats.includes(chatId)) {
    return false
  }
  return true
}

/**
 * Filter a message for an app — returns null if outside app's scope.
 */
export function filterMessageForApp(message: Message, app: App): Message | null {
  if (!isChatInScope(app, message.chatId, message.isGroup)) return null
  return message
}

/**
 * Filter a chat for an app — returns null if outside app's scope.
 */
export function filterChatForApp(chat: Chat, app: App): Chat | null {
  if (!isChatInScope(app, chat.id, chat.isGroup)) return null
  return chat
}

/**
 * Restrict a MessageQuery to the app's allowed scope.
 * If the query asks for a specific chat outside scope, returns null (caller should 403).
 * If no chatId specified, adds scope filtering.
 */
export function scopeQuery(app: App, query: MessageQuery): MessageQuery | null {
  if (query.chatId) {
    // Check if the requested chat is a group by looking at the JID format
    const isGroup = query.chatId.endsWith('@g.us')
    if (!isChatInScope(app, query.chatId, isGroup)) {
      return null // caller should return 403
    }
    return query
  }

  // No specific chatId — the query will return all messages.
  // If app has specific chats, we can't easily filter in SQL, so we leave
  // the query as-is and filter results with filterMessageForApp in the route handler.
  return query
}
