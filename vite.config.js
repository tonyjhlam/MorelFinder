import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves from https://<user>.github.io/<repo>/
  // Set base to '/MorelFinder/' to match the repo name.
  // For a custom domain or user/org root site, change to '/'.
  base: '/MorelFinder/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
