/**
 * Emergency reconnect CLI — `npm run reconnect`
 *
 * Two modes:
 * 1. Server is running: writes data/.reconnect signal file. The running server
 *    watches for it, disconnects Baileys, and reconnects (printing QR if needed).
 * 2. Server is crashed: starts a minimal Baileys instance, prints QR in terminal,
 *    saves auth, and exits. Next server start picks up the fresh auth.
 */

import * as fs from 'fs'
import * as path from 'path'

const reconnectFile = path.join(process.cwd(), 'data', '.reconnect')
const healthUrl = `http://localhost:${process.env.PORT ?? 3100}/health`

async function main() {
  // Check if server is running by hitting health endpoint
  let serverRunning = false
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
    serverRunning = res.ok
  } catch {
    serverRunning = false
  }

  if (serverRunning) {
    // Mode 1: Signal the running server
    const dataDir = path.dirname(reconnectFile)
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(reconnectFile, Date.now().toString())
    console.log('[reconnect] Signal sent to running server.')
    console.log('[reconnect] Check server logs for QR code (if needed).')
    console.log('[reconnect] On Railway: check the deployment logs.')
  } else {
    // Mode 2: Standalone reconnect
    console.log('[reconnect] Server is not running. Starting standalone reconnect...')
    const { useMultiFileAuthState, fetchLatestBaileysVersion, default: makeWASocket } = await import('@whiskeysockets/baileys')
    const qrcode = await import('qrcode-terminal')

    const { state, saveCreds } = await useMultiFileAuthState('./data/auth')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({ version, auth: state })
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection, qr }) => {
      if (qr) {
        console.log('[reconnect] Scan this QR code:')
        qrcode.generate(qr, { small: true })
      }
      if (connection === 'open') {
        console.log('[reconnect] Connected! Auth saved to data/auth/')
        console.log('[reconnect] You can now start the server with: npm run start')
        setTimeout(() => {
          sock.end(undefined)
          process.exit(0)
        }, 2000)
      }
    })
  }
}

main().catch(err => {
  console.error('[reconnect] Failed:', err)
  process.exit(1)
})
