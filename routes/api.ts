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
      const chats = await adapter.getChats()
      const filtered = chats
        .map(c => filterChatForApp(c, app))
        .filter((c): c is NonNullable<typeof c> => c !== null)
      res.json(filtered)
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
      const limit = Number(req.query.limit ?? 50)
      const sinceStr = req.query.since as string | undefined
      const since = sinceStr ? new Date(sinceStr) : undefined

      const query = scopeQuery(app, { chatId, limit, since })
      if (query === null) {
        res.status(403).json({ error: 'chat_id is outside this app\'s scope' })
        return
      }

      const messages = await adapter.getMessages(query)
      const filtered = messages
        .map(m => filterMessageForApp(m, app))
        .filter((m): m is NonNullable<typeof m> => m !== null)
      res.json(filtered)
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
      const media = store.getMedia() as any[]
      const filtered = media.filter(m => {
        const isGroup = (m.chat_id as string)?.endsWith('@g.us') ?? false
        const chatType = isGroup ? 'group' : 'dm'
        if (!app.scopeChatTypes.includes(chatType as 'dm' | 'group')) return false
        if (app.scopeSpecificChats.length > 0 && !app.scopeSpecificChats.includes(m.chat_id)) return false
        return true
      })
      res.json(filtered)
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
