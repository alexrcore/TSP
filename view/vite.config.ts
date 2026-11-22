import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['cpsat-js', 'cpsat-js/portable', 'highs'] },
  worker: { format: 'es' },
})
