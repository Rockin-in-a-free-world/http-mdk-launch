import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const dirname = fileURLToPath(new URL('.', import.meta.url))

// Scoped build for the /docs RPC console only. The rest of this repo is
// deliberately zero-build vanilla JS (see src/server.js, src/landing.js) —
// this tool config stays inside console/ and must not leak out.
export default defineConfig({
  plugins: [react()],
  base: '/docs/',
  resolve: {
    alias: {
      // see src/stubs/docusaurus-router.js
      '@docusaurus/router': `${dirname}src/stubs/docusaurus-router.js`,
      // see src/stubs/react-syntax-highlighter.js and src/stubs/prism-styles.js
      'react-syntax-highlighter/dist/cjs/styles/prism': `${dirname}src/stubs/prism-styles.js`,
      'react-syntax-highlighter': `${dirname}src/stubs/react-syntax-highlighter.js`
    }
  },
  build: {
    outDir: '../dist/console',
    emptyOutDir: true
  }
})
