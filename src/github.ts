/** GitHub REST helpers — list repos, atomic multi-file commit, create/delete */

export type GitHubConfig = {
  token: string
  owner: string
  repo: string
  branch: string
}

export type RepoInfo = {
  id: number
  name: string
  full_name: string
  owner: string
  private: boolean
  default_branch: string
  description: string | null
}

async function ghJson<T = any>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text }
  }
  if (!res.ok) {
    const msg = data?.message || text || `GitHub ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function getAuthenticatedUser(token: string): Promise<string> {
  const u = await ghJson<{ login: string }>(token, '/user')
  return u.login
}

export async function listAllRepos(token: string): Promise<RepoInfo[]> {
  const out: RepoInfo[] = []
  let page = 1
  while (page <= 10) {
    const list = await ghJson<any[]>(token, `/user/repos?per_page=100&page=${page}&sort=updated`)
    if (!list?.length) break
    for (const r of list) {
      out.push({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        owner: r.owner?.login || '',
        private: !!r.private,
        default_branch: r.default_branch || 'main',
        description: r.description || null,
      })
    }
    if (list.length < 100) break
    page++
  }
  return out
}

export async function createRepo(
  token: string,
  name: string,
  opts?: { description?: string; private?: boolean; auto_init?: boolean }
): Promise<RepoInfo> {
  const r = await ghJson<any>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: opts?.description || '',
      private: opts?.private ?? false,
      auto_init: opts?.auto_init ?? true,
    }),
  })
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login || '',
    private: !!r.private,
    default_branch: r.default_branch || 'main',
    description: r.description || null,
  }
}

export async function getFile(
  config: GitHubConfig,
  path: string
): Promise<{ path: string; content: string; sha: string } | null> {
  const clean = path.replace(/^\/+/, '')
  const encoded = clean.split('/').map(encodeURIComponent).join('/')
  try {
    const f = await ghJson<any>(
      config.token,
      `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${config.branch || 'main'}`
    )
    if (!f || f.type !== 'file') return null
    const content = f.encoding === 'base64' ? atob(f.content.replace(/\n/g, '')) : f.content
    return { path: f.path, content, sha: f.sha }
  } catch {
    return null
  }
}

export async function putFile(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const clean = path.replace(/^\/+/, '')
  const encoded = clean.split('/').map(encodeURIComponent).join('/')
  const existing = await getFile(config, clean)
  await ghJson(config.token, `/repos/${config.owner}/${config.repo}/contents/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message.slice(0, 200),
      content: toBase64(content),
      branch: config.branch || 'main',
      ...(existing?.sha ? { sha: existing.sha } : {}),
    }),
  })
}

export async function listDir(
  config: GitHubConfig,
  path = ''
): Promise<{ path: string; type: string; sha?: string }[]> {
  const clean = path.replace(/^\/+/, '')
  const encoded = clean ? clean.split('/').map(encodeURIComponent).join('/') : ''
  const url = `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${config.branch || 'main'}`
  const data = await ghJson<any>(config.token, url)
  if (!Array.isArray(data)) return []
  return data.map((x: any) => ({ path: x.path, type: x.type, sha: x.sha }))
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

const GIT_EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

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
  } catch {
    const readmeBlob = await ghJson<{ sha: string }>(config.token, `${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: toBase64('# Repo dibersihkan\n'), encoding: 'base64' }),
    })
    const readmeTree = await ghJson<{ sha: string }>(config.token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: readmeBlob.sha }],
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

/** Hapus HANYA path yang diminta (bukan kosongkan seluruh repo) */
export async function deleteManyFiles(
  config: GitHubConfig,
  paths: string[],
  messagePrefix = 'Virtual Office AI: hapus'
): Promise<{ deleted: string[]; errors: string[] }> {
  const unique = [...new Set(paths.map((p) => p.replace(/^\/+/, '').trim()).filter(Boolean))]
  if (!unique.length) return { deleted: [], errors: [] }

  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'
  const deleted: string[] = []
  const errors: string[] = []

  try {
    const ref = await ghJson<{ object: { sha: string } }>(config.token, `${base}/git/ref/heads/${branch}`)
    const latestCommitSha = ref.object.sha
    const commit = await ghJson<{ tree: { sha: string } }>(config.token, `${base}/git/commits/${latestCommitSha}`)

    const treeItems = unique.map((path) => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: null as null,
    }))

    const newTree = await ghJson<{ sha: string }>(config.token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeItems }),
    })
    const newCommit = await ghJson<{ sha: string }>(config.token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `${messagePrefix}: ${unique.length} file`.slice(0, 200),
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    })
    await ghJson(config.token, `${base}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    })
    return { deleted: unique, errors: [] }
  } catch (e: unknown) {
    for (const path of unique) {
      try {
        await deleteFile(config, path, `${messagePrefix}: ${path}`)
        deleted.push(path)
      } catch (err: unknown) {
        errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!deleted.length && !errors.length) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
    return { deleted, errors }
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
    const path = f.path.replace(/^\/+/, '').trim()
    if (!path) continue
    if (f.action === 'delete') deletes.add(path)
    else upserts.set(path, f.content)
  }

  if (!upserts.size && !deletes.size) {
    return { ok: [], errors: ['Tidak ada perubahan'], deleted: [] }
  }

  if (!upserts.size && deletes.size) {
    const result = await deleteManyFiles(config, [...deletes], messagePrefix + ': hapus')
    return { ok: [], errors: result.errors, deleted: result.deleted }
  }

  const base = `/repos/${config.owner}/${config.repo}`
  const branch = config.branch || 'main'
  const ok: string[] = []
  const errors: string[] = []
  const deleted: string[] = []

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

export async function loadProjectContext(config: GitHubConfig, maxFiles = 15): Promise<string> {
  const parts: string[] = []
  try {
    const all = await listRepoFiles(config, 300)
    if (all.length) parts.push('--- DAFTAR FILE DI REPO ---\n' + all.join('\n'))
  } catch {
    /* ignore */
  }
  for (const path of ['README.md', 'index.html', 'styles.css', 'app.js', 'package.json']) {
    if (parts.length > maxFiles) break
    try {
      const f = await getFile(config, path)
      if (f) parts.push(`--- FILE: ${f.path} ---\n${f.content.slice(0, 5000)}`)
    } catch {
      /* ignore */
    }
  }
  return parts.join('\n\n')
}
