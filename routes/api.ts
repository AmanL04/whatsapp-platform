import { Router } from 'express'
import type { WAAdapter } from '../core/adapter'
import type { SQLiteStore } from '../adapters/baileys/store'
import { checkPermission, scopeQuery, filterMessageForApp, filterChatForApp } from '../apps/permissions'

export function createApiRouter(adapter: WAAdapter, store: SQLiteStore): Router {
  const router = Router()

  // GET /api/chats — requires chats.read
  router.get('/chats', async (req, res) => {
    const app = req.waApp!
    if (!checkPermission(app, 'chats.read')) {
      res.status(403).json({ error: 'Missing permission: chats.read' })
      return
    }

    try {
      const limit = Number(req.query.limit ?? 20)
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? Math.floor(new Date(afterStr).getTime() / 1000) : undefined
      const before = beforeStr ? Math.floor(new Date(beforeStr).getTime() / 1000) : undefined
      const chats = await adapter.getChats({ after, before, limit })
      const filtered = chats
        .map(c => filterChatForApp(c, app))
        .filter((c): c is NonNullable<typeof c> => c !== null)
      res.json({
        data: filtered,
        cursors: {
          next: filtered.length > 0 ? filtered[filtered.length - 1].lastMessageAt.toISOString() : null,
          previous: filtered.length > 0 ? filtered[0].lastMessageAt.toISOString() : null,
        },
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/messages — requires messages.read
  router.get('/messages', async (req, res) => {
    const app = req.waApp!
    if (!checkPermission(app, 'messages.read')) {
      res.status(403).json({ error: 'Missing permission: messages.read' })
      return
    }

    try {
      const chatId = req.query.chatId as string | undefined
      const limit = Number(req.query.limit ?? 20)
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? new Date(afterStr) : undefined
      const before = beforeStr ? new Date(beforeStr) : undefined

      const query = scopeQuery(app, { chatId, limit, after, before })
      if (query === null) {
        res.status(403).json({ error: 'chat_id is outside this app\'s scope' })
        return
      }

      const messages = await adapter.getMessages(query)
      const filtered = messages
        .map(m => filterMessageForApp(m, app))
        .filter((m): m is NonNullable<typeof m> => m !== null)
      res.json({
        data: filtered,
        cursors: {
          next: filtered.length > 0 ? filtered[filtered.length - 1].timestamp.toISOString() : null,
          previous: filtered.length > 0 ? filtered[0].timestamp.toISOString() : null,
        },
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/media — requires media.read
  router.get('/media', (_req, res) => {
    const app = _req.waApp!
    if (!checkPermission(app, 'media.read')) {
      res.status(403).json({ error: 'Missing permission: media.read' })
      return
    }

    try {
      const type = _req.query.type as string | undefined
      const sender = _req.query.sender as string | undefined
      const source = _req.query.source as 'chat' | 'story' | undefined
      const afterStr = _req.query.after as string | undefined
      const beforeStr = _req.query.before as string | undefined
      const after = afterStr ? Math.floor(new Date(afterStr).getTime() / 1000) : undefined
      const before = beforeStr ? Math.floor(new Date(beforeStr).getTime() / 1000) : undefined
      const limit = Number(_req.query.limit ?? 20)
      const media = store.getMedia({ type, sender, source, after, before, limit })
      const filtered = media.filter(m => filterMessageForApp(m, app) !== null)
      res.json({
        data: filtered,
        cursors: {
          next: filtered.length > 0 ? filtered[filtered.length - 1].timestamp.toISOString() : null,
          previous: filtered.length > 0 ? filtered[0].timestamp.toISOString() : null,
        },
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/media/:id/download — requires media.download
  router.get('/media/:id/download', async (req, res) => {
    const app = req.waApp!
    if (!checkPermission(app, 'media.download')) {
      res.status(403).json({ error: 'Missing permission: media.download' })
      return
    }

    try {
      const buffer = await adapter.downloadMedia(req.params.id)
      res.setHeader('Content-Type', 'application/octet-stream')
      res.send(buffer)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/messages/send — requires messages.send
  router.post('/messages/send', async (req, res) => {
    const app = req.waApp!
    if (!checkPermission(app, 'messages.send')) {
      res.status(403).json({ error: 'Missing permission: messages.send' })
      return
    }

    const { chatId, content } = req.body
    if (!chatId || !content) {
      res.status(400).json({ error: 'Missing chatId or content' })
      return
    }

    // Check scope
    const isGroup = chatId.endsWith('@g.us')
    const chatType = isGroup ? 'group' : 'dm'
    if (!app.scopeChatTypes.includes(chatType as 'dm' | 'group')) {
      res.status(403).json({ error: 'chat_id is outside this app\'s scope' })
      return
    }
    if (app.scopeSpecificChats.length > 0 && !app.scopeSpecificChats.includes(chatId)) {
      res.status(403).json({ error: 'chat_id is outside this app\'s scope' })
      return
    }

    try {
      await adapter.sendMessage(chatId, content)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
