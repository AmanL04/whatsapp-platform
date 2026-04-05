import cron from 'node-cron'
import type { WAAdapter } from './adapter'
import type { PluginContext, Message, Media } from './types'

export interface Plugin {
  name: string
  description: string
  subscribes?: ('onMessage' | 'onMedia')[]
  schedule?: string
  run(context: PluginContext): Promise<void>
}

export class PluginRuntime {
  private plugins: Plugin[] = []
  private adapter: WAAdapter

  constructor(adapter: WAAdapter) {
    this.adapter = adapter
  }

  register(plugin: Plugin) {
    this.plugins.push(plugin)
    console.log(`[runtime] registered plugin: ${plugin.name}`)
  }

  start() {
    // Wire up live event subscriptions
    this.adapter.onMessage((msg: Message) => {
      for (const p of this.plugins) {
        if (p.subscribes?.includes('onMessage')) {
          this.runPlugin(p, { message: msg })
        }
      }
    })

    this.adapter.onMedia((media: Media) => {
      for (const p of this.plugins) {
        if (p.subscribes?.includes('onMedia')) {
          this.runPlugin(p, { media })
        }
      }
    })

    // Wire up scheduled plugins
    for (const p of this.plugins) {
      if (p.schedule) {
        cron.schedule(p.schedule, () => this.runPlugin(p))
        console.log(`[runtime] scheduled ${p.name}: ${p.schedule}`)
      }
    }
  }

  private async runPlugin(plugin: Plugin, extra: Partial<PluginContext> = {}) {
    try {
      await plugin.run({
        adapter: this.adapter,
        notify: (text) => console.log(`[${plugin.name}] notify: ${text}`),
        log: (msg) => console.log(`[${plugin.name}] ${msg}`),
        ...extra,
      })
    } catch (err) {
      console.error(`[runtime] plugin ${plugin.name} failed:`, err)
    }
  }
}
