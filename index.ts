import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'

import { BaileysAdapter } from './adapters/baileys'
import { AppRegistry } from './apps/registry'
import { WebhookDispatcher } from './apps/dispatcher'
import { createApiAuthMiddleware } from './middleware/api-auth'
import { DashboardAuth } from './middleware/dashboard-auth'
import { createApiRouter } from './routes/api'
import { createDashboardApiRouter } from './routes/dashboard-api'
import { cleanOldDeliveries } from './apps/cleanup'
import type { EventName } from './core/events'
import cron from 'node-cron'

// ─── Environment validation ──────────────────────────────────────────────────

const APP_ENV = process.env.APP_ENV ?? 'local'
const PORT = Number(process.env.PORT ?? 6745)

if (!process.env.JWT_SECRET) {
  console.error('[fatal] JWT_SECRET is not set in .env. Server cannot start.')
  process.exit(1)
}
if (!process.env.DB_ENCRYPTION_SECRET) {
  console.error('[fatal] DB_ENCRYPTION_SECRET is not set in .env. Server cannot start.')
  process.exit(1)
}
// Resolve dashboard origin: explicit env var > Railway's auto-provided domain > none (local dev)
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN
  ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined)

if ((APP_ENV === 'prod' || APP_ENV === 'dev') && !DASHBOARD_ORIGIN) {
  console.error(`[fatal] DASHBOARD_ORIGIN (or RAILWAY_PUBLIC_DOMAIN) is required when APP_ENV=${APP_ENV}. Server cannot start.`)
  process.exit(1)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  // 1. Adapter
  const adapter = new BaileysAdapter('./data/auth', './data/whatsapp.db', process.env.DB_ENCRYPTION_SECRET)
  const store = adapter.getStore()

  // 2. App registry + webhook dispatcher
  const registry = new AppRegistry(store, APP_ENV)
  const dispatcher = new WebhookDispatcher(registry, store)

  adapter.setEventDispatcher((event, payload, chatId, isGroup) => {
    dispatcher.dispatch(event as EventName, payload, chatId, isGroup)
  })

  // Re-queue stuck deliveries from a previous crash
  dispatcher.requeueStuckDeliveries()

  // Delivery log cleanup — run on start + daily at 3am
  const deleted = cleanOldDeliveries(store)
  if (deleted > 0) console.log(`[cleanup] removed ${deleted} old delivery logs`)
  cron.schedule('0 3 * * *', () => {
    const n = cleanOldDeliveries(store)
    if (n > 0) console.log(`[cleanup] daily: removed ${n} old delivery logs`)
  })

  // 3. Connect
  adapter.onConnected(() => {
    console.log('[main] connected — webhook dispatcher active')
  })

  adapter.onDisconnected((reason) => {
    console.log(`[main] disconnected: ${reason}`)
  })

  // Watch for reconnect signal file
  const reconnectFile = path.join(process.cwd(), 'data', '.reconnect')
  fs.watchFile(reconnectFile, { interval: 2000 }, async () => {
    if (fs.existsSync(reconnectFile)) {
      console.log('[main] reconnect signal detected — reconnecting Baileys...')
      fs.unlinkSync(reconnectFile)
      await adapter.disconnect()
      await adapter.connect()
    }
  })

  await adapter.connect()

  // 5. Express server
  const app = express()

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Let the SPA handle its own CSP
  }))
  app.use(express.json())
  app.use(cookieParser())

  // ─── Health check (unauthenticated) ──────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      connected: adapter.isConnected(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    })
  })

  // ─── /api/* — Scoped API for external apps ───────────────────────────────

  // No CORS on API routes — server-to-server, browsers shouldn't call these
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    // Use app ID as rate limit key (resolved by auth middleware before this runs)
    // Falls back to IP for unauthenticated requests (which will 401 anyway)
    keyGenerator: (req) => req.waApp?.id ?? 'unauthenticated',
    message: { error: 'Rate limit exceeded. Max 100 requests per minute.' },
  })

  app.use('/api', apiLimiter, createApiAuthMiddleware(registry), createApiRouter(adapter, store))

  // ─── /dashboard/* — Dashboard UI + admin API ─────────────────────────────

  const dashboardAuth = new DashboardAuth(process.env.JWT_SECRET!, adapter, APP_ENV)

  // CORS for dashboard
  if (APP_ENV === 'local') {
    app.use('/dashboard', cors())
  } else {
    app.use('/dashboard', cors({
      origin: DASHBOARD_ORIGIN,
      credentials: true,
    }))
  }

  // Serve built dashboard SPA in non-local environments (before auth middleware)
  const dashboardDist = path.join(process.cwd(), 'dashboard', 'dist')
  if (fs.existsSync(dashboardDist) && APP_ENV !== 'local') {
    app.use('/dashboard', express.static(dashboardDist))
  }

  // Dashboard auth + API routes
  const dashboardRouter = createDashboardApiRouter(adapter, store, registry, dashboardAuth)
  app.use('/dashboard', dashboardAuth.middleware(), dashboardRouter)

  // SPA catch-all — serves index.html for client-side routing (after API routes)
  if (fs.existsSync(dashboardDist) && APP_ENV !== 'local') {
    app.get('/dashboard/*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'))
    })
  }

  // ─── Test webhook endpoint (local self-testing only) ──────────────────────

  if (APP_ENV === 'local') {
    app.post('/test/webhook', (req, res) => {
      console.log(`[test-webhook] received: ${req.headers['x-webhook-event']} from ${req.headers['x-app-id']}`)
      console.log(`[test-webhook] signature: ${req.headers['x-webhook-signature']}`)
      res.status(200).json({ received: true })
    })
  }

  // ─── Start ───────────────────────────────────────────────────────────────

  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`)
    console.log(`[api] APP_ENV=${APP_ENV}`)
    console.log(`[api] health: http://localhost:${PORT}/health`)
    console.log(`[api] scoped API: http://localhost:${PORT}/api/*`)
    console.log(`[api] dashboard: http://localhost:${PORT}/dashboard/*`)
  })
}

main().catch(console.error)
