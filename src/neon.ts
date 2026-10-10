/** Neon API — buat project Postgres via proxy /api/neon (hindari CORS) */

export type NeonProjectResult = {
  projectId: string
  projectName: string
  connectionUri: string
  databaseName: string
  roleName: string
  host: string
  regionId: string
}

async function neonProxy(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch('/api/neon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let data: any = {}
  try {
    data = await res.json()
  } catch {
    /* empty */
  }
  return { ok: res.ok, status: res.status, data }
}

/** Buat project Neon baru; mengembalikan connection URI siap pakai */
export async function createNeonProject(
  apiKey: string,
  opts: { name: string; regionId?: string; pgVersion?: number; databaseName?: string }
): Promise<NeonProjectResult> {
  const key = apiKey.trim()
  if (!key) throw new Error('Neon API key kosong. Isi di Settings → Connectors → Neon.')

  const name =
    opts.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'vo-db'

  let res: { ok: boolean; status: number; data: any }
  try {
    res = await neonProxy({
      action: 'createProject',
      apiKey: key,
      name,
      regionId: opts.regionId || 'aws-ap-southeast-1',
      pgVersion: opts.pgVersion || 16,
      databaseName: opts.databaseName,
    })
  } catch (e: unknown) {
    throw new Error(
      'Gagal menghubungi proxy Neon (/api/neon): ' +
        (e instanceof Error ? e.message : String(e)) +
        '. Pastikan app di-deploy di Vercel (bukan file://) dan fungsi /api/neon aktif.'
    )
  }

  if (!res.ok) {
    const msg =
      res.data?.error ||
      res.data?.message ||
      (typeof res.data === 'string' ? res.data : null) ||
      `Neon ${res.status}`
    if (res.status === 401 || res.status === 403) {
      throw new Error('Neon API key tidak valid. Buat key di console.neon.tech → Account → API keys.')
    }
    if (res.status === 404) {
      throw new Error('Proxy /api/neon tidak ditemukan. Redeploy Virtual Office ke Vercel.')
    }
    throw new Error(String(msg).slice(0, 300))
  }

  const project = res.data?.project || {}
  const uris: any[] = res.data?.connection_uris || []
  const uri =
    uris[0]?.connection_uri ||
    uris[0]?.connection_parameters?.uri ||
    ''

  if (!uri) {
    throw new Error('Project Neon dibuat tetapi connection URI tidak ada. Cek di console.neon.tech.')
  }

  const databases = res.data?.databases || []
  const roles = res.data?.roles || []

  return {
    projectId: project.id || '',
    projectName: project.name || name,
    connectionUri: uri,
    databaseName: databases[0]?.name || opts.databaseName || 'neondb',
    roleName: roles[0]?.name || 'neondb_owner',
    host: (() => {
      try {
        return new URL(uri.replace(/^postgres(ql)?:/, 'https:')).hostname
      } catch {
        return ''
      }
    })(),
    regionId: project.region_id || opts.regionId || '',
  }
}

export async function listNeonProjects(apiKey: string): Promise<{ id: string; name: string }[]> {
  try {
    const res = await neonProxy({ action: 'listProjects', apiKey: apiKey.trim() })
    if (!res.ok) return []
    const list = res.data?.projects || []
    return list.map((p: any) => ({ id: p.id, name: p.name }))
  } catch {
    return []
  }
}

export async function runNeonSql(connectionUri: string, sql: string): Promise<{ ok: boolean; detail: string }> {
  if (!connectionUri?.trim() || !sql?.trim()) {
    return { ok: false, detail: 'URI atau SQL kosong' }
  }
  try {
    let host = ''
    try {
      host = new URL(connectionUri.replace(/^postgres(ql)?:/, 'https:')).hostname
    } catch {
      return { ok: false, detail: 'Connection URI tidak valid' }
    }
    const res = await fetch(`https://${host}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': connectionUri,
      },
      body: JSON.stringify({ query: sql, params: [] }),
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, detail: `SQL HTTP ${res.status}: ${text.slice(0, 180)}` }
    }
    return { ok: true, detail: 'SQL dijalankan' }
  } catch {
    return {
      ok: false,
      detail: 'SQL tidak bisa dijalankan dari browser. Pakai file migrasi di repo.',
    }
  }
}

export function wantsNeonDatabase(task: string): boolean {
  const t = task.toLowerCase()
  return /\b(neon|postgres|postgresql|database|basis data|buat db|create database|skema|schema)\b/.test(t)
}

export function inferNeonName(task: string, fallback: string): string {
  const m =
    task.match(/(?:neon|database|db|project)\s+(?:baru\s+)?[«"']?([a-zA-Z0-9_-]{2,40})/i) ||
    task.match(/nama\s*[:=]\s*([a-zA-Z0-9_-]{2,40})/i)
  if (m?.[1]) return m[1]
  return (fallback || 'vo-db').slice(0, 40)
}
