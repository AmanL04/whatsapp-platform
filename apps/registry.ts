import * as crypto from 'crypto'
import type { SQLiteStore } from '../adapters/baileys/store'
import type { App, Permission } from '../core/types'
import type { EventName } from '../core/events'

export interface RegisterAppInput {
  name: string
  description?: string
  webhookGlobalUrl?: string
  webhookEvents?: { name: string; url?: string }[]
  permissions: Permission[]
  scopeChatTypes: ('dm' | 'group')[]
  scopeSpecificChats?: string[]
}

export class AppRegistry {
  private store: SQLiteStore
  private appEnv: string

  constructor(store: SQLiteStore, appEnv = 'local') {
    this.store = store
    this.appEnv = appEnv
  }

  registerApp(input: RegisterAppInput): App {
    if (!input.name) throw new Error('App name is required')

    // Validate webhook URLs if provided
    if (input.webhookGlobalUrl) this.validateWebhookUrl(input.webhookGlobalUrl)
    if (input.webhookEvents) {
      for (const event of input.webhookEvents) {
        if (event.url) this.validateWebhookUrl(event.url)
      }
    }

    // Webhook URL required if events are subscribed
    if (input.webhookEvents?.length && !input.webhookGlobalUrl) {
      throw new Error('Webhook URL is required when subscribing to events')
    }

    const id = 'app_' + crypto.randomBytes(12).toString('hex')
    const apiKey = 'wak_' + crypto.randomBytes(32).toString('hex')
    const webhookSecret = 'whs_' + crypto.randomBytes(32).toString('hex')

    const app = {
      id,
      name: input.name,
      description: input.description ?? '',
      webhookGlobalUrl: input.webhookGlobalUrl ?? '',
      webhookSecret,
      webhookEvents: input.webhookEvents ?? [],
      apiKey,
      permissions: input.permissions,
      scopeChatTypes: input.scopeChatTypes,
      scopeSpecificChats: input.scopeSpecificChats ?? [],
    }

    this.store.insertApp(app)

    return {
      ...app,
      active: true,
      createdAt: new Date(),
    }
  }

  listApps(): App[] {
    return this.store.listApps() as App[]
  }

  getAppById(id: string): App | null {
    return this.store.getAppById(id) as App | null
  }

  getAppByApiKey(key: string): App | null {
    return this.store.getAppByApiKey(key) as App | null
  }

  getSubscribedApps(eventName: EventName, chatId: string, isGroup: boolean): App[] {
    const apps = this.listApps()
    return apps.filter(app => {
      // 1. App must subscribe to this event
      const subscribedToEvent = app.webhookEvents.some(e => e.name === eventName)
      if (!subscribedToEvent) return false

      // 2. Chat type must match app's scope
      const chatType = isGroup ? 'group' : 'dm'
      if (!app.scopeChatTypes.includes(chatType)) return false

      // 3. If app has specific chat scope, chatId must be in it
      if (app.scopeSpecificChats.length > 0 && !app.scopeSpecificChats.includes(chatId)) {
        return false
      }

      return true
    })
  }

  updateApp(id: string, fields: Partial<App>): void {
    if (fields.webhookGlobalUrl) this.validateWebhookUrl(fields.webhookGlobalUrl)
    if (fields.webhookEvents) {
      for (const event of fields.webhookEvents) {
        if (event.url) this.validateWebhookUrl(event.url)
      }
    }
    this.store.updateApp(id, fields)
  }

  deactivateApp(id: string): void {
    this.store.deactivateApp(id)
  }

  regenerateApiKey(id: string): string {
    const newKey = 'wak_' + crypto.randomBytes(32).toString('hex')
    this.store.updateApp(id, { apiKey: newKey })
    return newKey
  }

  regenerateWebhookSecret(id: string): string {
    const newSecret = 'whs_' + crypto.randomBytes(32).toString('hex')
    this.store.updateApp(id, { webhookSecret: newSecret })
    return newSecret
  }

  /** Block internal/private URLs to prevent SSRF attacks */
  private validateWebhookUrl(url: string): void {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`Invalid webhook URL: ${url}`)
    }

    // Must be HTTPS in non-local environments
    if (this.appEnv !== 'local' && parsed.protocol !== 'https:') {
      throw new Error('Webhook URL must use HTTPS')
    }

    // Block internal/private hostnames
    const blocked = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.',     // link-local
      '10.',          // private class A
      '192.168.',     // private class C
    ]
    const hostname = parsed.hostname.toLowerCase()
    for (const prefix of blocked) {
      if (hostname === prefix || hostname.startsWith(prefix)) {
        throw new Error(`Webhook URL cannot point to internal/private address: ${hostname}`)
      }
    }
    // Block 172.16.0.0/12 (private class B)
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      throw new Error(`Webhook URL cannot point to internal/private address: ${hostname}`)
    }
  }
}
