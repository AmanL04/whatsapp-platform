import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import { BaileysAdapter } from './adapters/baileys'
import { PluginRuntime } from './core/runtime'

// Plugins
import dailySummary from './plugins/daily-summary'
import contentRecap from './plugins/content-recap'
import taskExtractor from './plugins/task-extractor'

const PORT = Number(process.env.PORT ?? 3100)

async function main() {
  // 1. Pick your adapter — swap this line to change connection layer
  const adapter = new BaileysAdapter('./data/auth', './data/whatsapp.db', process.env.DB_ENCRYPTION_SECRET)
  const store = adapter.getStore()

  // 2. Register plugins
  const runtime = new PluginRuntime(adapter)
  runtime.register(dailySummary)
  runtime.register(contentRecap)
  runtime.register(taskExtractor)

  // 3. Connect — QR code will print in terminal on first run
  adapter.onConnected(() => {
    console.log('[main] connected — starting plugin runtime')
    runtime.start()
  })

  adapter.onDisconnected((reason) => {
    console.log(`[main] disconnected: ${reason}`)
  })

  await adapter.connect()

  // 4. Express API for dashboard
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/chats', async (_req, res) => {
    try {
      const chats = await adapter.getChats()
      res.json(chats)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/messages', async (req, res) => {
    try {
      const chatId = req.query.chatId as string | undefined
      const limit = Number(req.query.limit ?? 50)
      const messages = await adapter.getMessages({ chatId, limit })
      res.json(messages)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/tasks', (_req, res) => {
    try {
      const tasks = store.getTasks()
      res.json(tasks)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.post('/api/tasks/:id/done', (req, res) => {
    try {
      store.markTaskDone(Number(req.params.id))
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/media', (_req, res) => {
    try {
      const media = store.getMedia()
      res.json(media)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/summaries', (_req, res) => {
    try {
      const summaries = store.getSummaries()
      res.json(summaries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`)
  })
}

main().catch(console.error)
