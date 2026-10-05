/** GitHub REST helpers — list all repos, read/write files, create repo */

export type GitHubConfig = {
  token: string
  owner: string
  repo: string
  branch: string
}

export type RepoInfo = {
  name: string
  full_name: string
  owner: string
  default_branch: string
  private: boolean
  html_url: string
  description: string | null
}

async function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  return fetch(`https://api.github.com${path}`, { ...init, headers })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** UTF-8 safe base64 (works for shell scripts, unicode, etc.) */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function getAuthenticatedUser(token: string): Promise<string> {
  const res = await gh(token, '/user')
  if (!res.ok) throw new Error(`GitHub auth gagal: ${res.status}`)
  const data = await res.json()
  return data.login as string
}

export async function listAllRepos(token: string): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = []
  let page = 1
  while (page <= 10) {
    const res = await gh(token, `/user/repos?per_page=100&page=${page}&sort=updated`)
    if (!res.ok) throw new Error(`Gagal list repo: ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    for (const r of data) {
      repos.push({
        name: r.name,
        full_name: r.full_name,
        owner: r.owner?.login || r.full_name.split('/')[0],
        default_branch: r.default_branch || 'main',
        private: !!r.private,
        html_url: r.html_url,
        description: r.description,
      })
    }
    if (data.length < 100) break
    page++
  }
  return repos
}

export async function getFile(
  config: GitHubConfig,
  path: string
): Promise<{ path: string; content: string; sha: string } | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await gh(config.token, `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${config.branch}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`getFile ${path}: ${res.status}`)
  const data = await res.json()
  if (data.type !== 'file' || !data.content) return null
  const content = atob(data.content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0))
  const text = new TextDecoder().decode(bytes)
  return { path: data.path, content: text, sha: data.sha }
}

export async function listDir(config: GitHubConfig, path = ''): Promise<{ path: string; type: string }[]> {
  const p = path
    ? `/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`
    : `/repos/${config.owner}/${config.repo}/contents?ref=${config.branch}`
  const res = await gh(config.token, p)
  if (!res.ok) throw new Error(`Gagal list: ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((x: { path: string; type: string }) => ({ path: x.path, type: x.type }))
}

export async function putFile(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string
): Promise<{ html_url?: string }> {
  const cleanPath = path.replace(/^\/+/, '').replace(/\0/g, '').trim()
  if (!cleanPath) throw new Error('Path file kosong')

  let sha: string | undefined
  try {
    const existing = await getFile(config, cleanPath)
    sha = existing?.sha
  } catch {
    /* new file */
  }

  const body: Record<string, string> = {
    message: message.slice(0, 200),
    content: toBase64(content),
    branch: config.branch || 'main',
  }
  if (sha) body.sha = sha

  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/')
  const res = await gh(config.token, `/repos/${config.owner}/${config.repo}/contents/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Gagal push ${cleanPath}: ${res.status} ${t.slice(0, 180)}`)
  }
  const data = await res.json()
  return { html_url: data.content?.html_url || data.commit?.html_url }
}

export async function pushMany(
  config: GitHubConfig,
  files: { path: string; content: string }[],
  messagePrefix: string
): Promise<{ ok: string[]; errors: string[] }> {
  const ok: string[] = []
  const errors: string[] = []

  const map = new Map<string, string>()
  for (const f of files) {
    const p = f.path.replace(/^\/+/, '').trim()
    if (!p || !f.content) continue
    map.set(p, f.content)
  }

  for (const [path, content] of map) {
    let success = false
    let lastErr = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (attempt > 0) await sleep(800 * attempt)
        await putFile(config, path, content, `${messagePrefix}: ${path}`)
        ok.push(path)
        success = true
        break
      } catch (e: unknown) {
        lastErr = e instanceof Error ? e.message : String(e)
        if (/Failed to fetch|429|403|409|rate/i.test(lastErr)) {
          await sleep(1500 * (attempt + 1))
          continue
        }
        await sleep(500)
      }
    }
    if (!success) errors.push(`${path}: ${lastErr}`)
    await sleep(350)
  }

  return { ok, errors }
}

export async function loadProjectContext(config: GitHubConfig, maxFiles = 8): Promise<string> {
  const candidates = [
    'README.md',
    'readme.md',
    'package.json',
    'index.html',
    'src/App.tsx',
    'src/main.tsx',
    'app.py',
    'main.py',
  ]
  const parts: string[] = []
  let count = 0
  for (const path of candidates) {
    if (count >= maxFiles) break
    try {
      const f = await getFile(config, path)
      if (f) {
        parts.push(`--- FILE: ${f.path} ---\n${f.content.slice(0, 4000)}`)
        count++
      }
    } catch {
      /* skip */
    }
  }
  if (!parts.length) {
    try {
      const list = await listDir(config, '')
      parts.push('--- Struktur root ---\n' + list.map((x) => `${x.type}: ${x.path}`).join('\n'))
    } catch {
      /* empty */
    }
  }
  return parts.join('\n\n')
}

export async function createRepo(
  token: string,
  name: string,
  opts?: { description?: string; private?: boolean; auto_init?: boolean }
): Promise<RepoInfo> {
  const res = await gh(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      description: opts?.description || '',
      private: opts?.private ?? false,
      auto_init: opts?.auto_init ?? true,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Gagal buat repo: ${res.status} ${t.slice(0, 200)}`)
  }
  const r = await res.json()
  return {
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login || r.full_name.split('/')[0],
    default_branch: r.default_branch || 'main',
    private: !!r.private,
    html_url: r.html_url,
    description: r.description,
  }
}
