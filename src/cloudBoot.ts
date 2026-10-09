/** Cloud boot — auto-load settings on every device without waiting for GitHub login */
import { scheduleCloudSave, bootstrapCloudSync } from './storeBackend'

type StoreApi = {
  getState: () => any
  setState: (p: any) => void
}

/** Panggil dari main.tsx setelah store siap */
export function startCloudSync(store: StoreApi) {
  const get = () => store.getState()
  const set = (p: any) => store.setState(p)

  // Auto-load OpenRouter / API / skill dari Supabase
  bootstrapCloudSync({ get, set }).catch((e) => console.warn('cloud load', e))

  // Patch setConfig agar setiap ubah API key auto-save ke cloud
  const original = get().setConfig
  if (typeof original === 'function' && !(original as any).__cloudPatched) {
    const patched = (c: any) => {
      original(c)
      scheduleCloudSave({ get, set })
    }
    ;(patched as any).__cloudPatched = true
    store.setState({ setConfig: patched })
  }
}
