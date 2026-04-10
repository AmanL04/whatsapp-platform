import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { WAAdapter } from '../core/adapter'
import type { SQLiteStore } from '../adapters/baileys/store'

/**
 * Creates and configures the MCP server with WhatsApp tools.
 * Shared between stdio (local) and HTTP (embedded in Express) transports.
 */
export function createMcpServer(adapter: WAAdapter, store: SQLiteStore): McpServer {
  const server = new McpServer({
    name: 'whatsapp',
    version: '0.1.0',
  })

  // ─── Tools ──────────────────────────────────────────────────────────────────

  server.registerTool('list_chats', {
    description: 'List WhatsApp chats with name, last message time, and unread count. Filter by type (dm/group) or search by name.',
    inputSchema: {
      type: z.enum(['dm', 'group']).optional().describe('Filter by chat type'),
      search: z.string().optional().describe('Search chats by name'),
      limit: z.number().optional().describe('Max results (default 20, max 100)'),
    },
  }, async ({ type, search, limit }) => {
    let chats = await adapter.getChats({ limit: limit ?? 20 })
    if (type) chats = chats.filter(c => type === 'group' ? c.isGroup : !c.isGroup)
    if (search) {
      const q = search.toLowerCase()
      chats = chats.filter(c => c.name.toLowerCase().includes(q))
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(chats, null, 2) }] }
  })

  server.registerTool('get_messages', {
    description: 'Get messages from a WhatsApp chat. Supports pagination and search within chat.',
    inputSchema: {
      chatId: z.string().describe('Chat JID (e.g. 919986273519@s.whatsapp.net or 120363410346002725@g.us)'),
      limit: z.number().optional().describe('Max messages to return (default 20, max 100)'),
      before: z.string().optional().describe('ISO 8601 timestamp — get messages older than this'),
      after: z.string().optional().describe('ISO 8601 timestamp — get messages newer than this'),
      search: z.string().optional().describe('Search within message content'),
    },
  }, async ({ chatId, limit, before, after, search }) => {
    const messages = await adapter.getMessages({
      chatId,
      limit: limit ?? 20,
      before: before ? new Date(before) : undefined,
      after: after ? new Date(after) : undefined,
      search,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(messages, null, 2) }] }
  })

  server.registerTool('search_messages', {
    description: 'Full-text search across all WhatsApp chats. Returns matching messages with chat context.',
    inputSchema: {
      query: z.string().describe('Search text'),
      limit: z.number().optional().describe('Max results (default 20, max 100)'),
      before: z.string().optional().describe('ISO 8601 timestamp — search before this date'),
      after: z.string().optional().describe('ISO 8601 timestamp — search after this date'),
    },
  }, async ({ query, limit, before, after }) => {
    const messages = await adapter.searchMessages(query, {
      limit: limit ?? 20,
      before: before ? Math.floor(new Date(before).getTime() / 1000) : undefined,
      after: after ? Math.floor(new Date(after).getTime() / 1000) : undefined,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(messages, null, 2) }] }
  })

  server.registerTool('get_media', {
    description: 'List media files (images, videos, audio, documents) from WhatsApp. Filter by type, sender, or date.',
    inputSchema: {
      type: z.enum(['image', 'video', 'audio', 'document', 'sticker']).optional().describe('Media type filter'),
      sender: z.string().optional().describe('Filter by sender name (partial match)'),
      source: z.enum(['chat', 'story']).optional().describe('Filter by source — chat messages or status stories'),
      limit: z.number().optional().describe('Max results (default 20, max 100)'),
      before: z.string().optional().describe('ISO 8601 timestamp'),
      after: z.string().optional().describe('ISO 8601 timestamp'),
    },
  }, async ({ type, sender, source, limit, before, after }) => {
    const media = store.getMedia({
      type,
      sender,
      source,
      limit: limit ?? 20,
      before: before ? Math.floor(new Date(before).getTime() / 1000) : undefined,
      after: after ? Math.floor(new Date(after).getTime() / 1000) : undefined,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(media, null, 2) }] }
  })

  server.registerTool('get_chat_info', {
    description: 'Get detailed info about a specific chat — name, type, participants (for groups).',
    inputSchema: {
      chatId: z.string().describe('Chat JID'),
    },
  }, async ({ chatId }) => {
    const isGroup = chatId.endsWith('@g.us')
    const participants = isGroup ? store.getGroupParticipants(chatId) : null
    const info: Record<string, unknown> = { chatId, isGroup }
    if (participants) {
      info.name = participants.subject
      info.participantCount = participants.participants.length
      info.participants = participants.participants.map((p: any) => ({ id: p.id, admin: p.admin ?? null }))
    }
    const recentMessages = await adapter.getMessages({ chatId, limit: 1 })
    info.hasMessages = recentMessages.length > 0
    if (recentMessages.length > 0) info.lastMessageAt = recentMessages[0].timestamp
    return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] }
  })

  server.registerTool('send_message', {
    description: 'Send a text message to a WhatsApp chat. Use with caution.',
    inputSchema: {
      chatId: z.string().describe('Chat JID to send to'),
      content: z.string().describe('Message text'),
    },
    annotations: { destructiveHint: true },
  }, async ({ chatId, content }) => {
    try {
      const messageId = await adapter.sendMessage(chatId, content)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ sent: true, messageId }, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ sent: false, error: String(err) }, null, 2) }], isError: true }
    }
  })

  // ─── Resources ────────────────────────────────────────────────────────────

  server.registerResource('chats', 'whatsapp://chats', {}, async () => ({
    contents: [{
      uri: 'whatsapp://chats',
      mimeType: 'application/json',
      text: JSON.stringify(await adapter.getChats({ limit: 100 }), null, 2),
    }],
  }))

  return server
}

// ─── Standalone stdio entry point ─────────────────────────────────────────────

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config')
  const { SQLiteStore } = require('../adapters/baileys/store')
  const { runMigrations } = require('../migrations/runner')

  const DB_PATH = process.env.DB_PATH ?? './data/whatsapp.db'
  runMigrations(DB_PATH)

  const store = new SQLiteStore(DB_PATH, process.env.DB_ENCRYPTION_SECRET)

  // Read-only adapter shim for stdio mode (no live Baileys connection)
  const readOnlyAdapter = {
    getChats: (opts: any) => Promise.resolve(store.getChats(opts)),
    getMessages: (query: any) => Promise.resolve(store.getMessages(query)),
    searchMessages: (text: string, opts: any) => Promise.resolve(store.searchMessages(text, opts)),
    sendMessage: () => Promise.reject(new Error('send_message requires the main server to be running')),
    downloadMedia: () => Promise.reject(new Error('download_media requires the main server to be running')),
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    isConnected: () => false,
    onMessage: () => {},
    onConnected: () => {},
    onDisconnected: () => {},
  }

  const server = createMcpServer(readOnlyAdapter as any, store)
  const transport = new StdioServerTransport()
  server.connect(transport).then(() => {
    console.error('[mcp] WhatsApp MCP server running on stdio (read-only)')
  }).catch((err) => {
    console.error('[mcp] Fatal error:', err)
    process.exit(1)
  })
}
