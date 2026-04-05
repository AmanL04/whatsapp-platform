import { Router } from 'express'
import type { WAAdapter } from '../core/adapter'
import type { SQLiteStore } from '../adapters/baileys/store'
import type { AppRegistry, RegisterAppInput } from '../apps/registry'
import type { DashboardAuth } from '../middleware/dashboard-auth'

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
      const limit = Number(req.query.limit ?? 100)
      const appId = req.query.appId as string | undefined
      const status = req.query.status as string | undefined
      const deliveries = store.getDeliveries({ appId, status, limit })
      res.json(deliveries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/apps/:id/deliveries', (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 100)
      const deliveries = store.getDeliveries({ appId: req.params.id, limit })
      res.json(deliveries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Existing data endpoints (for debug/viewer UI)
  router.get('/api/chats', async (_req, res) => {
    try {
      const chats = await adapter.getChats()
      res.json(chats)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/messages', async (req, res) => {
    try {
      const chatId = req.query.chatId as string | undefined
      const limit = Number(req.query.limit ?? 50)
      const messages = await adapter.getMessages({ chatId, limit })
      res.json(messages)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/tasks', (_req, res) => {
    try {
      const tasks = store.getTasks()
      res.json(tasks)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/api/tasks/:id/done', (req, res) => {
    try {
      store.markTaskDone(Number(req.params.id))
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/media', (_req, res) => {
    try {
      const media = store.getMedia()
      res.json(media)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/api/summaries', (_req, res) => {
    try {
      const summaries = store.getSummaries()
      res.json(summaries)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
