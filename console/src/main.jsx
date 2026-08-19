// Must run before anything else.
import './stubs/browser-polyfills'
import './stubs/require-shim'

// Must run before anything touches monaco-editor.
import './monacoWorkers'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
