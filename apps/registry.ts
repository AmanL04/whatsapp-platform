import * as crypto from 'crypto'
import type { SQLiteStore } from '../adapters/baileys/store'
import type { App, Permission } from '../core/types'
import type { EventName } from '../core/events'

export interface RegisterAppInput {
  name: string
  description?: string
  webhookGlobalUrl: string
  webhookEvents: { name: string; url?: string }[]
  permissions: Permission[]
  scopeChatTypes: ('dm' | 'group')[]
  scopeSpecificChats?: string[]
}

export class AppRegistry {
  private store: SQLiteStore

  constructor(store: SQLiteStore) {
    this.store = store
  }

  registerApp(input: RegisterAppInput): App {
    if (!input.name) throw new Error('App name is required')
    if (!input.webhookGlobalUrl) throw new Error('Webhook URL is required')
    if (!input.webhookEvents || input.webhookEvents.length === 0) {
      throw new Error('At least one event subscription is required')
    }

    const id = 'app_' + crypto.randomBytes(12).toString('hex')
    const apiKey = 'wak_' + crypto.randomBytes(32).toString('hex')
    const webhookSecret = 'whs_' + crypto.randomBytes(32).toString('hex')

    const app = {
      id,
      name: input.name,
      description: input.description ?? '',
      webhookGlobalUrl: input.webhookGlobalUrl,
      webhookSecret,
      webhookEvents: input.webhookEvents,
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
}
