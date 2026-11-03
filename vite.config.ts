import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const serverPort = Number(process.env.PORT ?? 3939)

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // サーバーは開発時に 5173 番の画面からの接続だけを許可するので、別ポートに逃げないようにする
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
})
