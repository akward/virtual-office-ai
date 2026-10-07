/** Supabase REST client (tanpa dependency @supabase/supabase-js — tetap ringan). */

export type SupabaseConfig = {
  url: string
  anonKey: string
}

export function loadSupabaseConfig(): SupabaseConfig {
  if (typeof localStorage === 'undefined') {
    return { url: '', anonKey: '' }
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
  return rows[0].payload ?? null
}

export async function insertVoTask(
  cfg: SupabaseConfig,
  row: { user_key: string; repo?: string; task: string; status?: string; result_summary?: string }
): Promise<void> {
  const res = await sbFetch(cfg, 'vo_tasks', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_key: row.user_key,
      repo: row.repo || null,
      task: row.task,
      status: row.status || 'done',
      result_summary: row.result_summary || null,
    }),
  })
  if (!res.ok) {
    console.warn('vo_tasks insert', await res.text())
  }
}

export async function testSupabaseConnection(cfg: SupabaseConfig): Promise<string> {
  const res = await sbFetch(cfg, 'vo_settings?select=user_key&limit=1', {
    method: 'GET',
    headers: { Prefer: 'count=exact' },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Koneksi gagal ${res.status}: ${t.slice(0, 180)}`)
  }
  return 'OK — tabel vo_settings dapat diakses'
}
