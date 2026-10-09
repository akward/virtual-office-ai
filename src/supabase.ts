/** Supabase REST client (tanpa dependency @supabase/supabase-js — tetap ringan). */

export type SupabaseConfig = {
  url: string
  anonKey: string
}

export type SupabaseProfile = {
  id: string
  label: string
  url: string
  anonKey: string
}

export type VercelProfile = {
  id: string
  label: string
  token: string
  projectName?: string
  teamId?: string
}

const SB_PROFILES_KEY = 'vo_sb_profiles'
const SB_ACTIVE_KEY = 'vo_sb_active'
const VB_PROFILES_KEY = 'vo_vercel_profiles'
const VB_ACTIVE_KEY = 'vo_vercel_active'

/** Contoh profil (opsional) — tidak dipaksa sebagai default aktif */
export const EXAMPLE_SB_PROFILES: SupabaseProfile[] = [
  {
    id: 'vo-ai',
    label: 'virtual-office-ai',
    url: 'https://pwqpummgalevnamjrvnb.supabase.co',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cXB1bW1nYWxldm5hbWpydm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzODQ5ODEsImV4cCI6MjEwNjk2MDk4MX0.kofVsZ9JYUwGgYFUMmxTxRnNhevnLfG_PLBt_Rta1Vk',
  },
]

export const DEFAULT_SUPABASE_URL = ''
export const DEFAULT_SUPABASE_ANON_KEY = ''

export function loadSbProfiles(): SupabaseProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(SB_PROFILES_KEY)
    if (raw) return JSON.parse(raw) as SupabaseProfile[]
  } catch {
    /* */
  }
  return []
}

export function saveSbProfiles(list: SupabaseProfile[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SB_PROFILES_KEY, JSON.stringify(list))
}

export function getActiveSbId(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(SB_ACTIVE_KEY) || ''
}

export function setActiveSbId(id: string) {
  if (typeof localStorage === 'undefined') return
  if (id) localStorage.setItem(SB_ACTIVE_KEY, id)
  else localStorage.removeItem(SB_ACTIVE_KEY)
}

export function loadSupabaseConfig(): SupabaseConfig {
  if (typeof localStorage === 'undefined') {
    return { url: '', anonKey: '' }
  }
  const activeId = getActiveSbId()
  const profiles = loadSbProfiles()
  const active = profiles.find((p) => p.id === activeId)
  if (active) {
    return { url: active.url.replace(/\/$/, ''), anonKey: active.anonKey }
  }
  return {
    url: (localStorage.getItem('vo_sb_url') || '').replace(/\/$/, ''),
    anonKey: localStorage.getItem('vo_sb_key') || '',
  }
}

export function saveSupabaseConfig(c: Partial<SupabaseConfig>) {
  if (typeof localStorage === 'undefined') return
  if (c.url !== undefined) localStorage.setItem('vo_sb_url', c.url.replace(/\/$/, ''))
  if (c.anonKey !== undefined) localStorage.setItem('vo_sb_key', c.anonKey)
}

export function upsertSbProfile(profile: SupabaseProfile) {
  const list = loadSbProfiles().filter((p) => p.id !== profile.id && p.label !== profile.label)
  list.push(profile)
  saveSbProfiles(list)
  setActiveSbId(profile.id)
  saveSupabaseConfig({ url: profile.url, anonKey: profile.anonKey })
}

export function removeSbProfile(id: string) {
  const list = loadSbProfiles().filter((p) => p.id !== id)
  saveSbProfiles(list)
  if (getActiveSbId() === id) {
    setActiveSbId(list[0]?.id || '')
    if (list[0]) saveSupabaseConfig({ url: list[0].url, anonKey: list[0].anonKey })
    else saveSupabaseConfig({ url: '', anonKey: '' })
  }
}

export function selectSbProfile(id: string) {
  const p = loadSbProfiles().find((x) => x.id === id)
  if (!p) {
    setActiveSbId('')
    return
  }
  setActiveSbId(id)
  saveSupabaseConfig({ url: p.url, anonKey: p.anonKey })
}

export function loadVercelProfiles(): VercelProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(VB_PROFILES_KEY)
    if (raw) return JSON.parse(raw) as VercelProfile[]
  } catch {
    /* */
  }
  return []
}

export function saveVercelProfiles(list: VercelProfile[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(VB_PROFILES_KEY, JSON.stringify(list))
}

export function getActiveVercelId(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(VB_ACTIVE_KEY) || ''
}

export function setActiveVercelId(id: string) {
  if (typeof localStorage === 'undefined') return
  if (id) localStorage.setItem(VB_ACTIVE_KEY, id)
  else localStorage.removeItem(VB_ACTIVE_KEY)
}

export function getActiveVercelProfile(): VercelProfile | null {
  const id = getActiveVercelId()
  return loadVercelProfiles().find((p) => p.id === id) || null
}

export function upsertVercelProfile(profile: VercelProfile) {
  const list = loadVercelProfiles().filter((p) => p.id !== profile.id && p.label !== profile.label)
  list.push(profile)
  saveVercelProfiles(list)
  setActiveVercelId(profile.id)
}

export function removeVercelProfile(id: string) {
  const list = loadVercelProfiles().filter((p) => p.id !== id)
  saveVercelProfiles(list)
  if (getActiveVercelId() === id) setActiveVercelId(list[0]?.id || '')
}

export function selectVercelProfile(id: string) {
  if (!loadVercelProfiles().some((p) => p.id === id)) {
    setActiveVercelId('')
    return null
  }
  setActiveVercelId(id)
  return getActiveVercelProfile()
}

export function isSupabaseConfigured(c?: SupabaseConfig): boolean {
  const cfg = c || loadSupabaseConfig()
  return Boolean(cfg.url.trim() && cfg.anonKey.trim())
}

async function sbFetch(
  cfg: SupabaseConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${cfg.url.replace(/\/$/, '')}/rest/v1/${path.replace(/^\//, '')}`
  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(init.headers as Record<string, string> | undefined),
  }
  return fetch(url, { ...init, headers })
}

export async function upsertVoSettings(
  cfg: SupabaseConfig,
  userKey: string,
  payload: unknown
): Promise<void> {
  const res = await sbFetch(cfg, 'vo_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_key: userKey,
      payload,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Supabase simpan gagal ${res.status}: ${t.slice(0, 200)}`)
  }
}

export async function loadVoSettings(
  cfg: SupabaseConfig,
  userKey: string
): Promise<unknown | null> {
  const q = `vo_settings?user_key=eq.${encodeURIComponent(userKey)}&select=payload,updated_at`
  const res = await sbFetch(cfg, q, { method: 'GET', headers: { Prefer: 'return=representation' } })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Supabase baca gagal ${res.status}: ${t.slice(0, 200)}`)
  }
  const rows = await res.json()
  if (!Array.isArray(rows) || !rows.length) return null
  return rows[0].payload
}

export async function insertVoTask(
  cfg: SupabaseConfig,
  row: { user_key: string; repo?: string; task: string; result_summary?: string }
): Promise<void> {
  await sbFetch(cfg, 'vo_tasks', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...row, created_at: new Date().toISOString() }),
  }).catch(() => {})
}

export async function testSupabaseConnection(cfg: SupabaseConfig): Promise<string> {
  if (!cfg.url.trim() || !cfg.anonKey.trim()) return 'Isi URL dan Anon Key dulu.'
  try {
    const res = await sbFetch(cfg, 'vo_settings?select=user_key&limit=1', { method: 'GET' })
    if (res.ok) return `OK — terhubung ke ${cfg.url.replace(/^https?:\/\//, '').slice(0, 40)}`
    const t = await res.text()
    if (res.status === 404 || /relation|does not exist/i.test(t)) {
      return `Terhubung, tapi tabel vo_settings belum ada di project ini (${res.status}).`
    }
    return `HTTP ${res.status}: ${t.slice(0, 120)}`
  } catch (e: unknown) {
    return 'Gagal: ' + (e instanceof Error ? e.message : String(e))
  }
}
