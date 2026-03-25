import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const backendTarget =
    (process.env.BACKEND_TARGET_URL || fileEnv.BACKEND_TARGET_URL || '')
      .trim() || 'http://localhost:8000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // host: true can trigger uv_interface_addresses errors in some environments; use localhost so dev always starts
      host: 'localhost',
      port: 5174,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
