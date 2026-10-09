/** Deploy ke Vercel via API token */

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const DEPLOY_OK = /\.(html?|css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|txt|md|woff2?)$/i

type VercelProject = { id: string; name: string }

async function vercelFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
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

function errMsg(data: any, fallback: string): string {
  return (
    data?.error?.message ||
    data?.message ||
    (typeof data?.error === 'string' ? data.error : null) ||
    fallback
  )
}

async function ensureProject(
  token: string,
  name: string
): Promise<{ project: VercelProject; teamId?: string }> {
  const list = await vercelFetch(token, '/v9/projects?limit=100')
  if (list.ok && Array.isArray(list.data?.projects)) {
    const found = list.data.projects.find(
      (p: any) => p.name === name || p.name === name.replace(/-/g, '')
    )
    if (found) return { project: { id: found.id, name: found.name } }
  }

  const create = await vercelFetch(token, '/v9/projects', {
    method: 'POST',
    body: JSON.stringify({ name, framework: null }),
  })
  if (create.ok && create.data?.id) {
    return { project: { id: create.data.id, name: create.data.name || name } }
  }

  const teams = await vercelFetch(token, '/v2/teams?limit=20')
  if (teams.ok && Array.isArray(teams.data?.teams) && teams.data.teams.length) {
    for (const team of teams.data.teams) {
      const tid = team.id as string
      const tList = await vercelFetch(token, `/v9/projects?limit=100&teamId=${tid}`)
      if (tList.ok && Array.isArray(tList.data?.projects)) {
        const found = tList.data.projects.find((p: any) => p.name === name)
        if (found) return { project: { id: found.id, name: found.name }, teamId: tid }
      }
      const tCreate = await vercelFetch(token, `/v9/projects?teamId=${tid}`, {
        method: 'POST',
        body: JSON.stringify({ name, framework: null }),
      })
      if (tCreate.ok && tCreate.data?.id) {
        return {
          project: { id: tCreate.data.id, name: tCreate.data.name || name },
          teamId: tid,
        }
      }
    }
  }

  const reason = errMsg(create.data, list.data ? errMsg(list.data, '') : '')
  if (
    /permission|forbidden|create a project|create the project/i.test(reason) ||
    create.status === 403
  ) {
    throw new Error(
      'Token Vercel tidak boleh membuat project. Buat token baru di vercel.com/account/tokens dengan Scope = Full Account (bukan Project). Atau buat project manual di dashboard, lalu deploy lagi.'
    )
  }
  throw new Error(
    reason ||
      'Gagal akses project Vercel. Pastikan token Full Account dari vercel.com/account/tokens'
  )
}

export async function deployToVercel(opts: {
  token: string
  name: string
  files: { path: string; content: string }[]
}): Promise<{ url: string; id: string }> {
  const token = opts.token.trim()
  if (!token) throw new Error('Vercel token kosong')

  const name =
    opts.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'vo-app'

  const fileArr: { file: string; data: string; encoding: string }[] = []
  const seen = new Set<string>()

  for (const f of opts.files) {
    const p = f.path.replace(/^\/+/, '').trim()
    if (!p || f.content == null) continue
    if (/^output-/i.test(p.split('/').pop() || '')) continue
    if (p.endsWith('.sh')) continue
    if (!DEPLOY_OK.test(p) && !p.startsWith('api/')) continue
    if (seen.has(p)) continue
    seen.add(p)
    fileArr.push({ file: p, data: toBase64(f.content), encoding: 'base64' })
  }

  if (!seen.has('index.html') && !seen.has('index.htm')) {
    fileArr.push({
      file: 'index.html',
      data: toBase64(
        '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App</title><link rel="stylesheet" href="styles.css"></head><body><div id="app"><h1>Deploy OK</h1></div><script src="app.js"></script></body></html>'
      ),
      encoding: 'base64',
    })
  }

  if (!fileArr.length) throw new Error('Tidak ada file valid untuk deploy')

  const { project, teamId } = await ensureProject(token, name)

  const qs = new URLSearchParams()
  if (teamId) qs.set('teamId', teamId)
  qs.set('skipAutoDetectionConfirmation', '1')
  const q = qs.toString() ? `?${qs.toString()}` : ''

  const body: Record<string, unknown> = {
    name: project.name,
    project: project.id,
    files: fileArr,
    target: 'production',
    projectSettings: { framework: null },
  }

  const res = await vercelFetch(token, `/v13/deployments${q}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const msg = errMsg(res.data, `Vercel ${res.status}`)
    if (/permission|forbidden|project/i.test(msg)) {
      const retry = await vercelFetch(token, `/v13/deployments${q}`, {
        method: 'POST',
        body: JSON.stringify({
          name: project.name,
          files: fileArr,
          target: 'production',
        }),
      })
      if (retry.ok) {
        const rawUrl = retry.data.url || retry.data.alias?.[0] || ''
        const url = rawUrl
          ? rawUrl.startsWith('http')
            ? rawUrl
            : `https://${rawUrl}`
          : `https://${project.name}.vercel.app`
        return { url, id: retry.data.id || '' }
      }
      throw new Error(
        errMsg(retry.data, msg) +
          ' — Buat token Full Account di https://vercel.com/account/tokens (Scope: Full Account).'
      )
    }
    throw new Error(msg)
  }

  const rawUrl = res.data.url || res.data.alias?.[0] || ''
  const url = rawUrl
    ? rawUrl.startsWith('http')
      ? rawUrl
      : `https://${rawUrl}`
    : `https://${project.name}.vercel.app`

  return { url, id: res.data.id || '' }
}

export async function probeVercelAccount(token: string): Promise<string> {
  if (!token?.trim()) return 'Vercel: token belum diisi di Settings.'
  try {
    const res = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return `Vercel: token tidak valid / gagal login (${res.status}). ${data?.error?.message || data?.message || ''}`.trim()
    }
    const u = data.user || data
    const name = u.name || u.username || u.email || 'user'
    const email = u.email ? ` (${u.email})` : ''
    let teamsLine = ''
    try {
      const tr = await fetch('https://api.vercel.com/v2/teams?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const td = await tr.json().catch(() => ({}))
      if (tr.ok && Array.isArray(td.teams) && td.teams.length) {
        teamsLine = '\nTeam: ' + td.teams.map((t: any) => t.slug || t.name).join(', ')
      }
    } catch { /* optional */ }
    return `Vercel: login OK sebagai ${name}${email}.${teamsLine}`
  } catch (e: unknown) {
    return 'Vercel: gagal menghubungi API — ' + (e instanceof Error ? e.message : String(e))
  }
}

/** Set / upsert environment variables on a Vercel project */
export async function setVercelEnvVars(opts: {
  token: string
  projectNameOrId: string
  teamId?: string
  vars: { key: string; value: string; target?: ('production' | 'preview' | 'development')[] }[]
}): Promise<{ ok: string[]; errors: string[] }> {
  const token = opts.token.trim()
  if (!token) throw new Error('Vercel token kosong')
  if (!opts.projectNameOrId) throw new Error('Nama/ID project Vercel kosong')
  if (!opts.vars?.length) return { ok: [], errors: [] }

  const qs = new URLSearchParams({ upsert: 'true' })
  if (opts.teamId) qs.set('teamId', opts.teamId)

  const body = opts.vars.map((v) => ({
    key: v.key,
    value: v.value,
    type: 'encrypted' as const,
    target: v.target || (['production', 'preview', 'development'] as const),
  }))

  const res = await vercelFetch(
    token,
    `/v10/projects/${encodeURIComponent(opts.projectNameOrId)}/env?${qs.toString()}`,
    {
      method: 'POST',
      body: JSON.stringify(body.length === 1 ? body[0] : body),
    }
  )

  if (!res.ok) {
    const ok: string[] = []
    const errors: string[] = []
    for (const v of body) {
      const one = await vercelFetch(
        token,
        `/v10/projects/${encodeURIComponent(opts.projectNameOrId)}/env?${qs.toString()}`,
        { method: 'POST', body: JSON.stringify(v) }
      )
      if (one.ok) ok.push(v.key)
      else errors.push(`${v.key}: ${errMsg(one.data, String(one.status))}`)
    }
    if (!ok.length) throw new Error(errors.join('; ') || errMsg(res.data, `Vercel env ${res.status}`))
    return { ok, errors }
  }

  return { ok: opts.vars.map((v) => v.key), errors: [] }
}

export async function findVercelProject(
  token: string,
  name: string
): Promise<{ id: string; name: string; teamId?: string } | null> {
  const list = await vercelFetch(token, '/v9/projects?limit=100')
  if (list.ok && Array.isArray(list.data?.projects)) {
    const found = list.data.projects.find(
      (p: any) => p.name === name || p.name === name.replace(/_/g, '-')
    )
    if (found) return { id: found.id, name: found.name }
  }
  const teams = await vercelFetch(token, '/v2/teams?limit=20')
  if (teams.ok && Array.isArray(teams.data?.teams)) {
    for (const team of teams.data.teams) {
      const tid = team.id as string
      const tList = await vercelFetch(token, `/v9/projects?limit=100&teamId=${tid}`)
      if (tList.ok && Array.isArray(tList.data?.projects)) {
        const found = tList.data.projects.find((p: any) => p.name === name)
        if (found) return { id: found.id, name: found.name, teamId: tid }
      }
    }
  }
  return null
}
