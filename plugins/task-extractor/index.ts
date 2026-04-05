import type { Plugin } from '../../core/runtime'
import type { PluginContext } from '../../core/types'
import { SQLiteStore } from '../../adapters/baileys/store'

// Phrases that signal a commitment — ranked by confidence
const HIGH_CONFIDENCE = ['i will', "i'll", 'i promise', 'i commit', 'definitely will']
const MED_CONFIDENCE  = ['i should', 'i plan to', 'i intend to', 'going to']
const LOW_CONFIDENCE  = ['i might', 'i may', 'maybe i', 'possibly']

function scoreCommitment(text: string): { score: number; label: string } | null {
  const lower = text.toLowerCase()
  if (HIGH_CONFIDENCE.some(p => lower.includes(p))) return { score: 3, label: 'high' }
  if (MED_CONFIDENCE.some(p => lower.includes(p)))  return { score: 2, label: 'medium' }
  if (LOW_CONFIDENCE.some(p => lower.includes(p)))  return { score: 1, label: 'low' }
  return null
}

// Lazily initialized store — will be set from the adapter's store
let store: SQLiteStore | null = null

function getStore(): SQLiteStore {
  if (!store) {
    store = new SQLiteStore('./data/whatsapp.db')
  }
  return store
}

const taskExtractor: Plugin = {
  name: 'task-extractor',
  description: 'Detects commitments in messages and surfaces them as tasks',
  subscribes: ['onMessage'],

  async run({ message, log, notify }: PluginContext) {
    if (!message || message.type !== 'text') return

    const commitment = scoreCommitment(message.content)
    if (!commitment) return

    getStore().insertTask({
      messageId: message.id,
      chatId: message.chatId,
      fromName: message.senderName,
      content: message.content,
      confidence: commitment.label,
      score: commitment.score,
    })

    log(`task detected [${commitment.label}]: "${message.content}" — from ${message.senderName}`)
    notify(`New task (${commitment.label} confidence): ${message.content}`)
  },
}

export default taskExtractor
