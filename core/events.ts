export type EventName =
  | 'message.received'
  | 'media.received'
  | 'message.sent'
  | 'chat.updated'

export interface WebhookEnvelope {
  event: EventName
  appId: string
  timestamp: string // ISO 8601
  payload: unknown
}
