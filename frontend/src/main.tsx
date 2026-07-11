import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { enableConsoleOverride } from './utils/logger'

// Route standard console warnings and errors through our custom logger
enableConsoleOverride();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
