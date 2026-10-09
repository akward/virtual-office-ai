import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useStore } from './store'
import { startCloudSync } from './cloudBoot'

// Sync API key & setting dari Supabase di setiap device
startCloudSync(useStore)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
