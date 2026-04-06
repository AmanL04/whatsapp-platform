import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function getBackendPort(): string {
  const envPath = resolve(__dirname, '..', '.env')
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(/^PORT=(\d+)/m)
    if (match) return match[1]
  }
  return '6745'
}

export default defineConfig(() => {
  const backendUrl = `http://127.0.0.1:${getBackendPort()}`

  return {
    base: '/dashboard/',
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/dashboard/api': backendUrl,
        '/dashboard/auth': backendUrl,
      },
    },
  }
})
