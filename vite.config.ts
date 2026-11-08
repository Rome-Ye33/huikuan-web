import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './'：打包后的文件用相对路径，放到任何静态托管（GitHub Pages、Netlify、Vercel）的子目录都能打开
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
