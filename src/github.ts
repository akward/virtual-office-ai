/** GitHub REST helpers — list repos, atomic multi-file commit, create repo */

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

async function ghJson<T = unknown>(
  token: string,
  path: string,
  init: RequestInit = {},
  retries = 4
): Promise<T> {
  let lastErr = ''
  for (let i = 0; i < retries; i++) {
    try {
      const res = await gh(token, path, init)
      if (res.status === 429 || res.status === 403) {
        const t = await res.text()
        lastErr = `${res.status} ${t.slice(0, 120)}`
        await sleep(1500 * (i + 1))
        continue
      }
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`${res.status} ${t.slice(0, 200)}`)
      }
      if (res.status === 204) return {} as T
      return (await res.json()) as T
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
      if (/Failed to fetch|NetworkError|429|403/i.test(lastErr) && i < retries - 1) {
        await sleep(1200 * (i + 1))
        continue
      }
      throw e instanceof Error ? e : new Error(lastErr)
    }
  }
  throw new Error(lastErr || 'GitHub request failed')
}

export async function getAuthenticatedUser(token: string): Promise<string> {
  const data = await ghJson<{ login: string }>(token, '/user')
  return data.login
}

export async function listAllRepos(token: string): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = []
  let page = 1
  while (page <= 10) {
    const data = await ghJson<
      {
        name: string
        full_name: string
        owner: { login: string }
        default_branch: string
        private: boolean
        html_url: string
        description: string | null
      }[]
    >(token, `/user/repos?per_page=100&page=${page}&sort=updated`)
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
  try {
    const data = await ghJson<{
      type: string
      content?: string
      path: string
      sha: string
    }>(config.token, `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${config.branch}`)
    if (data.type !== 'file' || !data.content) return null
    const raw = atob(data.content.replace(/\n/g, ''))
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    return { path: data.path, content: new TextDecoder().decode(bytes), sha: data.sha }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.startsWith('404')) return null
    throw e
  }
}

export async function listDir(config: GitHubConfig, path = ''): Promise<{ path: string; type: string }[]> {
  const p = path
    ? `/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`
    : `/repos/${config.owner}/${config.repo}/contents?ref=${config.branch}`
  const data = await ghJson<{ path: string; type: string }[]>(config.token, p)
  if (!Array.isArray(data)) return []
  return data.map((x) => ({ path: x.path, type: x.type }))
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function putFile(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string
): Promise<{ html_url?: string }> {
  const cleanPath = path.replace(/^\/+/, '').trim()
  if (!cleanPath) throw new Error('Path kosong')

  let sha: string | undefined
  try {
    const existing = await getFile(config, cleanPath)
    sha = existing?.sha
  } catch {
    /* new */
  }

  const body: Record<string, string> = {
    message: message.slice(0, 200),
    content: toBase64(content),
    branch: config.branch || 'main',
  }
  if (sha) body.sha = sha

  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/')
  const data = await ghJson<{ content?: { html_url?: string }; commit?: { html_url?: string } }>(
    config.token,
    `/repos/${config.owner}/${config.repo}/contents/${encoded}`,
    { method: 'PUT', body: JSON.stringify(body) }
  )
  return { html_url: data.content?.html_url || data.commit?.html_url }
}

/** Atomic multi-file commit via Git Data API */
export async function pushMany(
  config: GitHubConfig,
  files: { path: string; content: string }[],
  messagePrefix: string
): Promise<{ ok: string[]; errors: string[] }> {
  const map = new Map<string, string>()
  for (const f of files) {
    const p = f.path.replace(/^\/+/, '').trim()
    if (!p || f.content == null || f.content === '') continue
    map.set(p, f.content)
  }
  if (map.size === 0) return { ok: [], errors: ['Tidak ada file valid'] }

  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'

  try {
    const ref = await ghJson<{ object: { sha: string } }>(
      config.token,
      `${base}/git/ref/heads/${branch}`
    )
    const latestCommitSha = ref.object.sha

    const commit = await ghJson<{ tree: { sha: string } }>(
      config.token,
      `${base}/git/commits/${latestCommitSha}`
    )
    const baseTreeSha = commit.tree.sha

    const treeItems: { path: string; mode: string; type: string; sha: string }[] = []
    const ok: string[] = []
    const errors: string[] = []

    for (const [path, content] of map) {
      try {
        const blob = await ghJson<{ sha: string }>(config.token, `${base}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: toBase64(content), encoding: 'base64' }),
        })
        treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
        ok.push(path)
        await sleep(200)
      } catch (e: unknown) {
        errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (treeItems.length === 0) {
      return { ok: [], errors: errors.length ? errors : ['Semua blob gagal'] }
    }

    const newTree = await ghJson<{ sha: string }>(config.token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    })

    const msg =
      `${messagePrefix}: ${treeItems.length} file` +
      (errors.length ? ` (${errors.length} gagal)` : '')
    const newCommit = await ghJson<{ sha: string }>(config.token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: msg.slice(0, 200),
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    })

    await ghJson(config.token, `${base}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    })

    if (errors.length) {
      for (const err of [...errors]) {
        const path = err.split(':')[0]
        const content = map.get(path)
        if (!content) continue
        try {
          await sleep(500)
          await putFile(config, path, content, `${messagePrefix}: ${path}`)
          ok.push(path)
          const idx = errors.indexOf(err)
          if (idx >= 0) errors.splice(idx, 1)
        } catch {
          /* keep */
        }
      }
    }

    return { ok, errors }
  } catch (e: unknown) {
    const ok: string[] = []
    const errors: string[] = []
    for (const [path, content] of map) {
      try {
        await putFile(config, path, content, `${messagePrefix}: ${path}`)
        ok.push(path)
      } catch (err: unknown) {
        errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
      await sleep(400)
    }
    if (ok.length === 0 && errors.length === 0) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
    return { ok, errors }
  }
}

export async function loadProjectContext(config: GitHubConfig, maxFiles = 8): Promise<string> {
  const candidates = [
    'README.md',
    'readme.md',
    'package.json',
    'index.html',
    'styles.css',
    'app.js',
    'src/App.tsx',
    'src/main.tsx',
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
  const r = await ghJson<{
    name: string
    full_name: string
    owner: { login: string }
    default_branch: string
    private: boolean
    html_url: string
    description: string | null
  }>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      description: opts?.description || '',
      private: opts?.private ?? false,
      auto_init: opts?.auto_init ?? true,
    }),
  })
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
