import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useStore } from './store'
import { startCloudSync } from './cloudBoot'
import { applyFullRoster } from './rosterBoot'

// 19 agent di lantai kantor
applyFullRoster(useStore)
// Sync API key antar device
startCloudSync(useStore)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
