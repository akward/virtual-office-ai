/** GitHub REST helpers (browser, uses user PAT) */

export interface GitHubConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

export interface RepoFile {
  path: string
  content: string
  sha?: string
}

async function gh(
  config: GitHubConfig,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
}

export async function testConnection(config: GitHubConfig): Promise<string> {
  const res = await gh(config, `/repos/${config.owner}/${config.repo}`)
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 150)}`)
  }
  const data = await res.json()
  return data.full_name as string
}

export async function getFile(
  config: GitHubConfig,
  path: string
): Promise<RepoFile | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await gh(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${config.branch}`
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Gagal baca ${path}: ${res.status}`)
  const data = await res.json()
  if (data.type !== 'file' || !data.content) return null
  const content = atob(data.content.replace(/\n/g, ''))
  return { path: data.path, content, sha: data.sha }
}

export async function listDir(
  config: GitHubConfig,
  path = ''
): Promise<{ path: string; type: string }[]> {
  const p = path
    ? `/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`
    : `/repos/${config.owner}/${config.repo}/contents?ref=${config.branch}`
  const res = await gh(config, p)
  if (!res.ok) throw new Error(`Gagal list: ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((x: { path: string; type: string }) => ({
    path: x.path,
    type: x.type,
  }))
}

export async function putFile(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string
): Promise<{ html_url?: string }> {
  let sha: string | undefined
  try {
    const existing = await getFile(config, path)
    sha = existing?.sha
  } catch {
    /* new file */
  }

  const body: Record<string, string> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: config.branch,
  }
  if (sha) body.sha = sha

  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await gh(config, `/repos/${config.owner}/${config.repo}/contents/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Gagal push ${path}: ${res.status} ${t.slice(0, 200)}`)
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
  for (const f of files) {
    try {
      await putFile(config, f.path, f.content, `${messagePrefix}: ${f.path}`)
      ok.push(f.path)
    } catch (e: unknown) {
      errors.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { ok, errors }
}

export async function loadProjectContext(
  config: GitHubConfig,
  maxFiles = 8
): Promise<string> {
  const candidates = [
    'README.md',
    'readme.md',
    'package.json',
    'src/App.tsx',
    'src/main.tsx',
    'src/index.ts',
    'app.py',
    'main.py',
    'index.html',
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
      parts.push(
        '--- Struktur root repo ---\n' + list.map((x) => `${x.type}: ${x.path}`).join('\n')
      )
    } catch {
      /* empty */
    }
  }
  return parts.join('\n\n')
}
