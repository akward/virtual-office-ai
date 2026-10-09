/** Neon API — buat project Postgres + connection string */

const NEON_API = 'https://console.neon.tech/api/v2'

export type NeonProjectResult = {
  projectId: string
  projectName: string
  connectionUri: string
  databaseName: string
  roleName: string
  host: string
  regionId: string
}

async function neonFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
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

  const body: any = {
    project: {
      name,
      region_id: opts.regionId || 'aws-ap-southeast-1',
      pg_version: opts.pgVersion || 16,
    },
  }
  if (opts.databaseName) {
    body.project.branch = {
      database_name: opts.databaseName,
      role_name: 'app_owner',
    }
  }

  const res = await neonFetch(key, '/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const msg =
      res.data?.message ||
      res.data?.error ||
      (typeof res.data === 'string' ? res.data : null) ||
      `Neon ${res.status}`
    if (res.status === 401 || res.status === 403) {
      throw new Error('Neon API key tidak valid / tidak berhak. Buat key di console.neon.tech → Account → API keys.')
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
    throw new Error('Project Neon dibuat tetapi connection URI tidak ada di respons. Cek di console.neon.tech.')
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
  const res = await neonFetch(apiKey.trim(), '/projects?limit=50')
  if (!res.ok) return []
  const list = res.data?.projects || []
  return list.map((p: any) => ({ id: p.id, name: p.name }))
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
  } catch (e: unknown) {
    return {
      ok: false,
      detail: 'SQL tidak bisa dijalankan dari browser (CORS/network). Pakai file migrasi di repo.',
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
