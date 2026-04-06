import { Router } from 'express'
import type { WAAdapter } from '../core/adapter'
import type { SQLiteStore } from '../adapters/baileys/store'
import type { AppRegistry, RegisterAppInput } from '../apps/registry'
import type { DashboardAuth } from '../middleware/dashboard-auth'
import { resolveCanonicalJid } from '../core/jid'

export function createDashboardApiRouter(
  adapter: WAAdapter,
  store: SQLiteStore,
  registry: AppRegistry,
  dashboardAuth: DashboardAuth,
): Router {
  const router = Router()

  // ─── Auth endpoints (no JWT required) ──────────────────────────────────────

  router.post('/auth/send-otp', (req, res) => dashboardAuth.sendOtp(req, res))
  router.post('/auth/verify-otp', (req, res) => dashboardAuth.verifyOtp(req, res))
  router.get('/api/auth/check', (req, res) => dashboardAuth.checkSession(req, res))

  // ─── Protected endpoints (JWT required via middleware) ─────────────────────

  // App management
  router.get('/api/apps', (_req, res) => {
    try {
      const apps = registry.listApps()
      // Mask secrets in list view
      const masked = apps.map(a => ({
        ...a,
        apiKey: a.apiKey.slice(0, 8) + '...',
        webhookSecret: a.webhookSecret.slice(0, 8) + '...',
      }))
      res.json(masked)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/api/apps', (req, res) => {
    try {
      const input: RegisterAppInput = req.body
      const app = registry.registerApp(input)
      // Return full secrets on creation (shown once)
      res.status(201).json(app)
    } catch (err) {
      res.status(400).json({ error: String(err) })
    }
  })

  router.get('/api/apps/:id', (req, res) => {
    try {
      const app = registry.getAppById(req.params.id)
      if (!app) {
        res.status(404).json({ error: 'App not found' })
        return
      }
      // Mask secrets in detail view
      res.json({
        ...app,
        apiKey: app.apiKey.slice(0, 8) + '...',
        webhookSecret: app.webhookSecret.slice(0, 8) + '...',
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.put('/api/apps/:id', (req, res) => {
    try {
      const app = registry.getAppById(req.params.id)
      if (!app) {
        res.status(404).json({ error: 'App not found' })
        return
      }
      registry.updateApp(req.params.id, req.body)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.delete('/api/apps/:id', (req, res) => {
    try {
      registry.deactivateApp(req.params.id)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/api/apps/:id/regenerate-key', (req, res) => {
    try {
      const newKey = registry.regenerateApiKey(req.params.id)
      res.json({ apiKey: newKey })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/api/apps/:id/regenerate-secret', (req, res) => {
    try {
      const newSecret = registry.regenerateWebhookSecret(req.params.id)
      res.json({ webhookSecret: newSecret })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Delivery logs
  router.get('/api/deliveries', (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 20)
      const appId = req.query.appId as string | undefined
      const status = req.query.status as string | undefined
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? Math.floor(new Date(afterStr).getTime() / 1000) : undefined
      const before = beforeStr ? Math.floor(new Date(beforeStr).getTime() / 1000) : undefined
      const deliveries = store.getDeliveries({ appId, status, after, before, limit })
      res.json(deliveries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/apps/:id/deliveries', (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 20)
      const after = req.query.after ? Math.floor(new Date(req.query.after as string).getTime() / 1000) : undefined
      const before = req.query.before ? Math.floor(new Date(req.query.before as string).getTime() / 1000) : undefined
      const deliveries = store.getDeliveries({ appId: req.params.id, after, before, limit })
      res.json(deliveries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Stats
  router.get('/api/stats', (_req, res) => {
    try {
      res.json(store.getStats())
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Existing data endpoints (for debug/viewer UI)
  router.get('/api/chats', async (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 20)
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? Math.floor(new Date(afterStr).getTime() / 1000) : undefined
      const before = beforeStr ? Math.floor(new Date(beforeStr).getTime() / 1000) : undefined
      const chats = await adapter.getChats({ after, before, limit })
      res.json(chats)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/messages', async (req, res) => {
    try {
      const rawChatId = req.query.chatId as string | undefined
      const chatId = rawChatId ? resolveCanonicalJid(rawChatId) : undefined
      const limit = Number(req.query.limit ?? 20)
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? new Date(afterStr) : undefined
      const before = beforeStr ? new Date(beforeStr) : undefined
      const messages = await adapter.getMessages({ chatId, limit, after, before })
      res.json(messages)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/media', (req, res) => {
    try {
      const type = req.query.type as string | undefined
      const sender = req.query.sender as string | undefined
      const source = req.query.source as 'chat' | 'story' | undefined
      const afterStr = req.query.after as string | undefined
      const beforeStr = req.query.before as string | undefined
      const after = afterStr ? Math.floor(new Date(afterStr).getTime() / 1000) : undefined
      const before = beforeStr ? Math.floor(new Date(beforeStr).getTime() / 1000) : undefined
      const limit = Number(req.query.limit ?? 20)
      const media = store.getMedia({ type, sender, source, after, before, limit })
      res.json(media)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
