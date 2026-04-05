import Anthropic from '@anthropic-ai/sdk'
import type { Plugin } from '../../core/runtime'
import type { PluginContext, Message } from '../../core/types'

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env

const dailySummary: Plugin = {
  name: 'daily-summary',
  description: 'Summarises all messages from the last 24 hours using an LLM',
  schedule: '0 9 * * *', // runs at 9am daily

  async run({ adapter, notify, log }: PluginContext) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const messages = await adapter.getMessages({ since })

    if (messages.length === 0) {
      log('no messages in last 24h')
      return
    }

    // Group by chat
    const byChatId: Record<string, Message[]> = {}
    for (const msg of messages) {
      byChatId[msg.chatId] = byChatId[msg.chatId] ?? []
      byChatId[msg.chatId].push(msg)
    }

    const summaries: string[] = []

    for (const [chatId, msgs] of Object.entries(byChatId)) {
      const chatName = msgs[0].groupName ?? msgs[0].senderName ?? chatId
      const block = msgs
        .map((m: Message) => `${m.senderName}: ${m.content}`)
        .join('\n')

      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Summarise these WhatsApp messages from "${chatName}" concisely. Focus on key decisions, action items, and important updates. Be brief.\n\n${block}`,
          }],
        })

        const summary = response.content[0].type === 'text' ? response.content[0].text : ''
        log(`summarised ${chatId} (${msgs.length} msgs)`)
        summaries.push(`**${chatName}** (${msgs.length} messages):\n${summary}`)
      } catch (err) {
        log(`LLM call failed for ${chatId}: ${err}`)
        summaries.push(`**${chatName}**: ${msgs.length} messages (summary unavailable)`)
      }
    }

    const fullSummary = `Daily Summary — ${new Date().toLocaleDateString()}\n\n${summaries.join('\n\n')}`
    notify(fullSummary)
  },
}

export default dailySummary
