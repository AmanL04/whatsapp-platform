import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load .env from the parent directory (where the server's .env lives)
  const env = loadEnv(mode, '..', '')
  const backendPort = env.PORT || '3100'
  const backendUrl = `http://localhost:${backendPort}`

  return {
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
