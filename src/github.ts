/** GitHub REST helpers — list repos, atomic multi-file commit, create/delete */

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

async function gh(token: string, path: string, init: RequestInit = {}, timeoutMs = 25000): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timeout ${timeoutMs}ms: ${path}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function ghJson<T = unknown>(
  token: string,
  path: string,
  init: RequestInit = {},
  retries = 3
): Promise<T> {
  let lastErr = ''
  for (let i = 0; i < retries; i++) {
    try {
      const res = await gh(token, path, init)
      if (res.status === 429 || res.status === 403) {
        const t = await res.text()
        lastErr = `${res.status} ${t.slice(0, 160)}`
        await sleep(1000 * (i + 1))
        continue
      }
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`${res.status} ${t.slice(0, 220)}`)
      }
      if (res.status === 204) return {} as T
      return (await res.json()) as T
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
      if (/Failed to fetch|NetworkError|Timeout|429|403/i.test(lastErr) && i < retries - 1) {
        await sleep(800 * (i + 1))
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

export async function listRepoFiles(config: GitHubConfig, max = 200): Promise<string[]> {
  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'
  try {
    const ref = await ghJson<{ object: { sha: string } }>(config.token, `${base}/git/ref/heads/${branch}`)
    const commit = await ghJson<{ tree: { sha: string } }>(config.token, `${base}/git/commits/${ref.object.sha}`)
    const tree = await ghJson<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      config.token,
      `${base}/git/trees/${commit.tree.sha}?recursive=1`
    )
    return (tree.tree || []).filter((t) => t.type === 'blob').map((t) => t.path).slice(0, max)
  } catch {
    try {
      const list = await listDir(config, '')
      return list.filter((x) => x.type === 'file').map((x) => x.path).slice(0, max)
    } catch {
      return []
    }
  }
}

export async function deleteFile(config: GitHubConfig, path: string, message: string): Promise<void> {
  const cleanPath = path.replace(/^\/+/, '').trim()
  if (!cleanPath) throw new Error('Path kosong')
  const existing = await getFile(config, cleanPath)
  if (!existing?.sha) throw new Error(`File tidak ada: ${cleanPath}`)
  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/')
  await ghJson(config.token, `/repos/${config.owner}/${config.repo}/contents/${encoded}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: message.slice(0, 200),
      sha: existing.sha,
      branch: config.branch || 'main',
    }),
  })
}

/** SHA tree kosong Git yang sudah dikenal (valid di semua repo) */
const GIT_EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Kosongkan branch:
 * 1) Commit ke tree kosong Git (SHA tetap)
 * 2) Fallback: tree baru hanya README.md (tanpa base_tree = ganti seluruh isi)
 */
export async function emptyRepoBranch(
  config: GitHubConfig,
  message = 'Virtual Office AI: kosongkan repo'
): Promise<void> {
  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'

  const ref = await ghJson<{ object: { sha: string } }>(config.token, `${base}/git/ref/heads/${branch}`)
  const latestCommitSha = ref.object.sha

  try {
    const newCommit = await ghJson<{ sha: string }>(config.token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: message.slice(0, 200),
        tree: GIT_EMPTY_TREE_SHA,
        parents: [latestCommitSha],
      }),
    })
    await ghJson(config.token, `${base}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    })
    return
  } catch {
    const readmeTree = await ghJson<{ sha: string }>(config.token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        tree: [
          {
            path: 'README.md',
            mode: '100644',
            type: 'blob',
            content: '# Repo dikosongkan\n\nDibersihkan oleh Virtual Office AI.\n',
          },
        ],
      }),
    })
    const newCommit = await ghJson<{ sha: string }>(config.token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: message.slice(0, 200),
        tree: readmeTree.sha,
        parents: [latestCommitSha],
      }),
    })
    await ghJson(config.token, `${base}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    })
  }
}

export async function deleteManyFiles(
  config: GitHubConfig,
  paths: string[],
  messagePrefix = 'Virtual Office AI: hapus'
): Promise<{ deleted: string[]; errors: string[] }> {
  const unique = [...new Set(paths.map((p) => p.replace(/^\/+/, '').trim()).filter(Boolean))]
  if (!unique.length) return { deleted: [], errors: [] }

  try {
    await emptyRepoBranch(config, `${messagePrefix} ${unique.length} file`)
    return { deleted: unique, errors: [] }
  } catch (e: unknown) {
    return {
      deleted: [],
      errors: [`Gagal kosongkan repo: ${e instanceof Error ? e.message : String(e)}`],
    }
  }
}

export async function pushMany(
  config: GitHubConfig,
  files: { path: string; content: string; action?: 'upsert' | 'delete' }[],
  messagePrefix: string
): Promise<{ ok: string[]; errors: string[]; deleted: string[] }> {
  const upserts = new Map<string, string>()
  const deletes = new Set<string>()

  for (const f of files) {
    const p = f.path.replace(/^\/+/, '').trim()
    if (!p) continue
    if (f.action === 'delete') {
      deletes.add(p)
      upserts.delete(p)
    } else if (f.content != null && f.content !== '') {
      upserts.set(p, f.content)
      deletes.delete(p)
    }
  }

  if (upserts.size === 0 && deletes.size === 0) {
    return { ok: [], errors: ['Tidak ada perubahan'], deleted: [] }
  }

  if (upserts.size === 0 && deletes.size > 0) {
    const result = await deleteManyFiles(config, [...deletes], messagePrefix + ': hapus')
    return { ok: [], errors: result.errors, deleted: result.deleted }
  }

  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'
  const ok: string[] = []
  const deleted: string[] = []
  const errors: string[] = []

  try {
    const ref = await ghJson<{ object: { sha: string } }>(config.token, `${base}/git/ref/heads/${branch}`)
    const latestCommitSha = ref.object.sha
    const commit = await ghJson<{ tree: { sha: string } }>(config.token, `${base}/git/commits/${latestCommitSha}`)
    const treeItems: { path: string; mode: string; type: string; sha: string | null }[] = []

    for (const [path, content] of upserts) {
      try {
        const blob = await ghJson<{ sha: string }>(config.token, `${base}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: toBase64(content), encoding: 'base64' }),
        })
        treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
        ok.push(path)
      } catch (e: unknown) {
        errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    for (const path of deletes) {
      treeItems.push({ path, mode: '100644', type: 'blob', sha: null })
      deleted.push(path)
    }
    if (!treeItems.length) return { ok: [], errors: errors.length ? errors : ['Kosong'], deleted: [] }

    const newTree = await ghJson<{ sha: string }>(config.token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeItems }),
    })
    const newCommit = await ghJson<{ sha: string }>(config.token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `${messagePrefix}: +${ok.length}/-${deleted.length}`.slice(0, 200),
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    })
    await ghJson(config.token, `${base}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    })
    return { ok, errors, deleted }
  } catch (e: unknown) {
    for (const [path, content] of upserts) {
      try {
        await putFile(config, path, content, `${messagePrefix}: ${path}`)
        ok.push(path)
      } catch (err: unknown) {
        errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (deletes.size) {
      const r = await deleteManyFiles(config, [...deletes], messagePrefix + ': hapus')
      deleted.push(...r.deleted)
      errors.push(...r.errors)
    }
    if (!ok.length && !deleted.length && !errors.length) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
    return { ok, errors, deleted }
  }
}

export async function loadProjectContext(config: GitHubConfig, maxFiles = 8): Promise<string> {
  const parts: string[] = []
  try {
    const all = await listRepoFiles(config, 150)
    if (all.length) parts.push('--- DAFTAR FILE DI REPO ---\n' + all.join('\n'))
  } catch {
    /* ignore */
  }
  for (const path of ['README.md', 'index.html', 'styles.css', 'app.js', 'package.json']) {
    if (parts.length > maxFiles) break
    try {
      const f = await getFile(config, path)
      if (f) parts.push(`--- FILE: ${f.path} ---\n${f.content.slice(0, 3500)}`)
    } catch {
      /* skip */
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
