import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Fest verdrahtet kollidiert das mit jedem zweiten Projekt, das
        // ebenfalls auf 3001 hört. API_PORT setzen, dann ziehen Server
        // (PORT) und Proxy gemeinsam um.
        target: `http://localhost:${process.env.API_PORT ?? '3001'}`,
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist/client',
  }
})
