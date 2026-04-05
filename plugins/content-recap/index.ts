import type { Plugin } from '../../core/runtime'
import type { PluginContext } from '../../core/types'
import * as fs from 'fs'
import * as path from 'path'

const contentRecap: Plugin = {
  name: 'content-recap',
  description: 'Collects all received media into a local recap folder',
  subscribes: ['onMedia'],

  async run({ adapter, media, log }: PluginContext) {
    if (!media) return

    const recapDir = path.join(process.cwd(), 'data', 'media-recap')
    if (!fs.existsSync(recapDir)) fs.mkdirSync(recapDir, { recursive: true })

    // If already downloaded to a local path, just log it
    if (media.localPath && fs.existsSync(media.localPath)) {
      log(`media available: ${media.localPath} (${media.type} from ${media.senderName})`)
      return
    }

    // Download the media from WhatsApp
    try {
      const buffer = await adapter.downloadMedia(media.id)
      const ext = media.mimeType.split('/')[1] ?? 'bin'
      const filename = `${media.id}.${ext}`
      const dest = path.join(recapDir, filename)
      fs.writeFileSync(dest, buffer)
      log(`saved: ${dest} (${media.type} from ${media.senderName})`)
    } catch (err) {
      log(`download failed for ${media.id}: ${err}`)
    }
  },
}

export default contentRecap
