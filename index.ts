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
import { createMcpServer } from './mcp/server'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { WhatsAppOAuthProvider } from './mcp/auth'

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

  // 1. Adapter (migrations already ran via `npm run migrate` before this process)
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

  // Serve built dashboard SPA (before auth middleware)
  const dashboardDist = path.join(process.cwd(), 'dashboard', 'dist')
  if (fs.existsSync(dashboardDist)) {
    app.use('/dashboard', express.static(dashboardDist))
  }

  // Dashboard auth + API routes
  const dashboardRouter = createDashboardApiRouter(adapter, store, registry, dashboardAuth)
  app.use('/dashboard', dashboardAuth.middleware(), dashboardRouter)

  // SPA catch-all — serves index.html for client-side routing (after API routes)
  if (fs.existsSync(dashboardDist)) {
    app.get('/dashboard/*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'))
    })
  }

  // ─── /mcp — MCP server for AI assistants (OAuth 2.1 protected) ────────────

  const oauthProvider = new WhatsAppOAuthProvider(store.getDb(), dashboardAuth)

  // OAuth endpoints: /.well-known/*, /authorize, /token, /register, /revoke
  const baseUrl = DASHBOARD_ORIGIN ?? `http://localhost:${PORT}`
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: new URL(baseUrl),
    serviceDocumentationUrl: new URL(`${baseUrl}/dashboard/`),
  }))

  // OTP endpoints for the authorize page
  app.post('/auth/mcp/send-otp', async (_req, res) => {
    const result = await oauthProvider.handleAuthSendOtp()
    if (!result.ok) {
      res.status(500).json(result)
      return
    }
    res.json(result)
  })

  app.post('/auth/mcp/verify-otp', (req, res) => {
    const { code, requestId, state } = req.body
    const result = oauthProvider.handleAuthVerifyOtp(code, requestId, state)
    if (result.error) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  })

  // MCP endpoint — protected by OAuth bearer token
  // Stateless mode: new server+transport per request (SDK requirement)
  app.all('/mcp', requireBearerAuth({ verifier: oauthProvider }), async (req, res) => {
    try {
      const server = createMcpServer(adapter, store)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('[mcp] request error:', err)
      if (!res.headersSent) res.status(500).json({ error: String(err) })
    }
  })

  console.log('[mcp] MCP server mounted at /mcp (OAuth 2.1 protected)')

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
    const baseUrl = DASHBOARD_ORIGIN ?? `http://localhost:${PORT}`
    console.log(`[api] listening on http://localhost:${PORT}`)
    console.log(`[api] APP_ENV=${APP_ENV}`)
    console.log(`[api] health: ${baseUrl}/health`)
    console.log(`[api] scoped API: ${baseUrl}/api/*`)
    console.log(`[api] dashboard: ${baseUrl}/dashboard/`)
  })
}

main().catch(console.error)
