import * as crypto from 'crypto'
import type { AppRegistry } from './registry'
import type { SQLiteStore } from '../adapters/baileys/store'
import type { EventName, WebhookEnvelope } from '../core/events'

const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 30000] // 1s, 5s, 30s

export class WebhookDispatcher {
  private registry: AppRegistry
  private store: SQLiteStore

  constructor(registry: AppRegistry, store: SQLiteStore) {
    this.registry = registry
    this.store = store
  }

  /**
   * Dispatch an event to all subscribed apps. Fire-and-forget —
   * never blocks the caller. Each app is delivered independently.
   */
  dispatch(eventName: EventName, payload: unknown, chatId: string, isGroup: boolean) {
    const apps = this.registry.getSubscribedApps(eventName, chatId, isGroup)
    if (apps.length === 0) return

    // Fire-and-forget — don't await
    Promise.allSettled(
      apps.map(app => this.deliverToApp(app, eventName, payload))
    ).catch(() => {}) // swallow — individual errors are already handled
  }

  /**
   * Re-queue deliveries that were stuck in 'retrying' status from a previous crash.
   * Called once on server startup.
   */
  async requeueStuckDeliveries() {
    const stuck = this.store.getRetryingDeliveries() as any[]
    if (stuck.length === 0) return

    console.log(`[dispatcher] re-queuing ${stuck.length} stuck deliveries`)
    for (const delivery of stuck) {
      const app = this.registry.getAppById(delivery.app_id)
      if (!app) {
        this.store.updateDelivery(delivery.id, { status: 'failed' })
        continue
      }
      this.retryDelivery(delivery.id, app, delivery.event, delivery.payload, delivery.attempts)
    }
  }

  private async deliverToApp(
    app: { id: string; webhookGlobalUrl: string; webhookSecret: string; webhookEvents: { name: string; url?: string }[] },
    eventName: EventName,
    payload: unknown,
  ) {
    // Resolve URL — event-specific override or global fallback
    const eventConfig = app.webhookEvents.find(e => e.name === eventName)
    const url = eventConfig?.url || app.webhookGlobalUrl

    // Build envelope
    const envelope: WebhookEnvelope = {
      event: eventName,
      appId: app.id,
      timestamp: new Date().toISOString(),
      payload,
    }

    const body = JSON.stringify(envelope)

    // Compute HMAC signature
    const signature = 'sha256=' + crypto
      .createHmac('sha256', app.webhookSecret)
      .update(body)
      .digest('hex')

    // Create delivery record
    const deliveryId = crypto.randomBytes(16).toString('hex')
    this.store.insertDelivery({
      id: deliveryId,
      appId: app.id,
      event: eventName,
      payload: body,
      status: 'pending',
    })

    // Attempt delivery
    await this.attemptDelivery(deliveryId, url, body, signature, app.id, 0)
  }

  private async attemptDelivery(
    deliveryId: string,
    url: string,
    body: string,
    signature: string,
    appId: string,
    attempt: number,
  ) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': JSON.parse(body).event,
          'X-App-Id': appId,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      this.store.updateDelivery(deliveryId, {
        status: response.ok ? 'delivered' : 'retrying',
        attempts: attempt + 1,
        lastAttemptAt: Math.floor(Date.now() / 1000),
        responseStatus: response.status,
      })

      if (!response.ok && attempt < MAX_RETRIES - 1) {
        this.scheduleRetry(deliveryId, url, body, signature, appId, attempt + 1)
      } else if (!response.ok) {
        this.store.updateDelivery(deliveryId, { status: 'failed' })
      }
    } catch (err) {
      this.store.updateDelivery(deliveryId, {
        status: attempt < MAX_RETRIES - 1 ? 'retrying' : 'failed',
        attempts: attempt + 1,
        lastAttemptAt: Math.floor(Date.now() / 1000),
      })

      if (attempt < MAX_RETRIES - 1) {
        this.scheduleRetry(deliveryId, url, body, signature, appId, attempt + 1)
      }
    }
  }

  private scheduleRetry(
    deliveryId: string,
    url: string,
    body: string,
    signature: string,
    appId: string,
    attempt: number,
  ) {
    const delay = RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]
    setTimeout(() => {
      this.attemptDelivery(deliveryId, url, body, signature, appId, attempt)
    }, delay)
  }

  private retryDelivery(
    deliveryId: string,
    app: { id: string; webhookGlobalUrl: string; webhookSecret: string; webhookEvents: { name: string; url?: string }[] },
    eventName: string,
    payload: string,
    currentAttempts: number,
  ) {
    const eventConfig = app.webhookEvents.find(e => e.name === eventName)
    const url = eventConfig?.url || app.webhookGlobalUrl

    const signature = 'sha256=' + crypto
      .createHmac('sha256', app.webhookSecret)
      .update(payload)
      .digest('hex')

    this.attemptDelivery(deliveryId, url, payload, signature, app.id, currentAttempts)
  }
}
