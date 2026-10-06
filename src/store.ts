import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo } from './types'
import { callLLM, extractArtifacts, paceBetweenAgents } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, listRepoFiles, deleteManyFiles, emptyRepoBranch, type GitHubConfig } from './github'

const defaultAgents: Agent[] = [
  { id: 'manager', name: 'Budi', role: 'Project Manager', color: '#3b82f6', emoji: '👔', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 18, y: 42 },
  { id: 'coder', name: 'Andi', role: 'Software Engineer', color: '#22c55e', emoji: '💻', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 42, y: 38 },
  { id: 'researcher', name: 'Siti', role: 'Researcher', color: '#a855f7', emoji: '🔍', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 66, y: 42 },
  { id: 'writer', name: 'Rina', role: 'Content Writer', color: '#f59e0b', emoji: '✍️', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 30, y: 68 },
  { id: 'security', name: 'Doni', role: 'Security Analyst', color: '#ef4444', emoji: '🛡️', status: 'idle', currentTask: '', lastMessage: 'Siap amankan!', x: 55, y: 62 },
]

function loadGH(): GitHubSettings {
  if (typeof localStorage === 'undefined') {
    return { token: '', owner: '', repo: '', branch: 'main', connected: false, repoFullName: '', username: '', autoPush: true }
  }
  return {
    token: localStorage.getItem('vo_gh_token') || '',
    owner: localStorage.getItem('vo_gh_owner') || '',
    repo: localStorage.getItem('vo_gh_repo') || '',
    branch: localStorage.getItem('vo_gh_branch') || 'main',
    connected: localStorage.getItem('vo_gh_connected') === '1',
    repoFullName: localStorage.getItem('vo_gh_fullname') || '',
    username: localStorage.getItem('vo_gh_user') || '',
    autoPush: localStorage.getItem('vo_gh_autopush') !== '0',
  }
}

function detectBulkDeleteAll(task: string): boolean {
  const t = task.toLowerCase().replace(/\s+/g, ' ')
  const patterns = [
    /hapus\s+semua\s+file/,
    /hapus\s+seluruh\s+file/,
    /hapus\s+semua\s+isi/,
    /hapus\s+semua/,
    /hapus\s+file[- ]?file/,
    /delete\s+all\s+files?/,
    /remove\s+all\s+files?/,
    /kosongkan\s+(repo|repository)/,
    /bersihkan\s+(semua\s+)?(isi\s+)?repo/,
    /bersihkan\s+repo/,
    /wipe\s+(the\s+)?repo/,
    /clear\s+(the\s+)?repo/,
    /hapus\s+semua\s+output/,
    /hapus\s+file\s+output/,
  ]
  return patterns.some((p) => p.test(t))
}

function detectRepoNameInTask(task: string): string | null {
  const m =
    task.match(/repo(?:sitory)?\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i) ||
    task.match(/repo(?:sitory)?\s+([a-zA-Z0-9_.-]+)/i) ||
    task.match(/di\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i)
  if (!m) return null
  return m[1].trim()
}

function detectExplicitDeletes(task: string): string[] {
  const paths: string[] = []
  const re = /(?:DELETE|HAPUS|REMOVE)\s*[:\-]\s*[`'\"]?([^\s`'\"]+)/gi
  let m
  while ((m = re.exec(task)) !== null) paths.push(m[1])
  return paths
}

interface Store {
  agents: Agent[]
  messages: Message[]
  artifacts: Artifact[]
  config: AppConfig
  github: GitHubSettings
  repos: RepoInfo[]
  projectContext: string
  isRunning: boolean
  isPushing: boolean
  isLoadingRepos: boolean
  isCreatingRepo: boolean
  setConfig: (c: Partial<AppConfig>) => void
  setGithub: (g: Partial<GitHubSettings>) => void
  connectWithToken: () => Promise<void>
  selectRepo: (fullName: string) => Promise<void>
  createNewRepo: (name: string, opts?: { description?: string; private?: boolean }) => Promise<void>
  loadContext: () => Promise<void>
  updateAgent: (id: string, patch: Partial<Agent>) => void
  addMessage: (from: string, text: string) => void
  addArtifacts: (list: Omit<Artifact, 'id' | 'createdAt'>[]) => void
  clearArtifacts: () => void
  runTask: (userTask: string) => Promise<void>
  pushArtifactsToGithub: () => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  agents: defaultAgents,
  messages: [],
  artifacts: [],
  repos: [],
  projectContext: '',
  isRunning: false,
  isPushing: false,
  isLoadingRepos: false,
  isCreatingRepo: false,
  config: {
    apiKey: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_api_key') || '' : '',
    baseUrl: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_base_url') || 'https://api.groq.com/openai/v1' : 'https://api.groq.com/openai/v1',
    model: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model') || 'openai/gpt-oss-20b' : 'openai/gpt-oss-20b',
  },
  github: loadGH(),

  setConfig: (c) => set((s) => {
    const next = { ...s.config, ...c }
    if (typeof localStorage !== 'undefined') {
      if (c.apiKey !== undefined) localStorage.setItem('vo_api_key', c.apiKey)
      if (c.baseUrl !== undefined) localStorage.setItem('vo_base_url', c.baseUrl)
      if (c.model !== undefined) localStorage.setItem('vo_model', c.model)
    }
    return { config: next }
  }),

  setGithub: (g) => set((s) => {
    const next = { ...s.github, ...g }
    if (typeof localStorage !== 'undefined') {
      if (g.token !== undefined) localStorage.setItem('vo_gh_token', g.token)
      if (g.owner !== undefined) localStorage.setItem('vo_gh_owner', g.owner)
      if (g.repo !== undefined) localStorage.setItem('vo_gh_repo', g.repo)
      if (g.branch !== undefined) localStorage.setItem('vo_gh_branch', g.branch)
      if (g.connected !== undefined) localStorage.setItem('vo_gh_connected', g.connected ? '1' : '0')
      if (g.repoFullName !== undefined) localStorage.setItem('vo_gh_fullname', g.repoFullName)
      if (g.username !== undefined) localStorage.setItem('vo_gh_user', g.username)
      if (g.autoPush !== undefined) localStorage.setItem('vo_gh_autopush', g.autoPush ? '1' : '0')
    }
    return { github: next }
  }),

  connectWithToken: async () => {
    const { github, setGithub, addMessage } = get()
    if (!github.token.trim()) throw new Error('Isi GitHub Personal Access Token dulu')
    set({ isLoadingRepos: true })
    try {
      const username = await getAuthenticatedUser(github.token)
      const repos = await listAllRepos(github.token)
      set({ repos })
      setGithub({ connected: true, username })
      addMessage('System', `Login @${username}. ${repos.length} repository ditemukan.`)
      const match = repos.find((r) => r.full_name === github.repoFullName) || repos[0]
      if (match) await get().selectRepo(match.full_name)
    } finally {
      set({ isLoadingRepos: false })
    }
  },

  selectRepo: async (fullName: string) => {
    const { repos, setGithub, addMessage } = get()
    const r = repos.find((x) => x.full_name === fullName)
    if (!r) throw new Error('Repo tidak ditemukan')
    setGithub({ owner: r.owner, repo: r.name, branch: r.default_branch || 'main', repoFullName: r.full_name, connected: true })
    addMessage('System', `Repo aktif: ${r.full_name} (${r.default_branch})`)
    await get().loadContext()
  },

  createNewRepo: async (name: string, opts?: { description?: string; private?: boolean }) => {
    const { github, addMessage, setGithub } = get()
    if (!github.token.trim()) throw new Error('Isi GitHub token dulu')
    const clean = name.trim()
    if (!clean) throw new Error('Isi nama repository')
    set({ isCreatingRepo: true })
    try {
      const repo = await createRepo(github.token, clean, {
        description: opts?.description,
        private: opts?.private ?? false,
        auto_init: true,
      })
      set((s) => ({ repos: [repo, ...s.repos.filter((r) => r.full_name !== repo.full_name)] }))
      setGithub({
        connected: true,
        username: github.username || repo.owner,
        owner: repo.owner,
        repo: repo.name,
        branch: repo.default_branch || 'main',
        repoFullName: repo.full_name,
      })
      addMessage('System', `Repo baru dibuat: ${repo.full_name}\n${repo.html_url}`)
      set({ projectContext: '' })
      addMessage('System', 'Repo masih kosong (hanya README awal). Kirim tugas agar agent menulis project.')
    } finally {
      set({ isCreatingRepo: false })
    }
  },

  loadContext: async () => {
    const { github, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) return
    const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
    try {
      const ctx = await loadProjectContext(cfg)
      set({ projectContext: ctx })
      addMessage('System', ctx ? `Konteks dimuat (${Math.round(ctx.length / 100) / 10}k karakter).` : 'Repo kosong.')
    } catch (e: unknown) {
      addMessage('System', `Gagal konteks: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  updateAgent: (id, patch) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  addMessage: (from, text) => set((s) => ({ messages: [...s.messages.slice(-100), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }] })),
  addArtifacts: (list) => set((s) => ({ artifacts: [...s.artifacts, ...list.map((a) => ({ ...a, id: crypto.randomUUID(), createdAt: Date.now() }))] })),
  clearArtifacts: () => set({ artifacts: [] }),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts, projectContext, github, repos } = get()
    if (get().isRunning) return
    if (!github.connected || !github.repo) {
      addMessage('System', 'Pilih repository GitHub dulu.')
      return
    }
    set({ isRunning: true })
    clearArtifacts()
    addMessage('Kamu', userTask)

    const mentioned = detectRepoNameInTask(userTask)
    if (mentioned) {
      const match =
        repos.find((r) => r.full_name.toLowerCase() === mentioned.toLowerCase()) ||
        repos.find((r) => r.name.toLowerCase() === mentioned.toLowerCase()) ||
        repos.find((r) => r.full_name.toLowerCase().endsWith('/' + mentioned.toLowerCase()))
      if (match && match.full_name !== github.repoFullName) {
        addMessage('System', `Beralih ke repo ${match.full_name} sesuai permintaan...`)
        try {
          await get().selectRepo(match.full_name)
        } catch (e: unknown) {
          addMessage('System', 'Gagal pilih repo: ' + (e instanceof Error ? e.message : String(e)))
        }
      }
    }

    const ghNow = get().github
    const cfgNow: GitHubConfig = {
      token: ghNow.token,
      owner: ghNow.owner,
      repo: ghNow.repo,
      branch: ghNow.branch || 'main',
    }

    if (detectBulkDeleteAll(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: 'Menghapus semua file...' })
      addMessage('System', `Memuat daftar file di ${ghNow.repoFullName} untuk dihapus semua...`)
      try {
        let files = await listRepoFiles(cfgNow, 500)
        if (/kecuali\s+readme/i.test(userTask)) {
          files = files.filter((f) => !/^readme\.md$/i.test(f))
        }
        if (!files.length) {
          addMessage('System', 'Repo sudah kosong — tidak ada file untuk dihapus.')
          updateAgent('manager', { status: 'done', lastMessage: 'Repo kosong', currentTask: '' })
          set({ isRunning: false })
          return
        }
        addMessage(
          'Budi (Manager)',
          `Akan menghapus ${files.length} file dari ${ghNow.repoFullName}:\n` +
            files.slice(0, 40).join(', ') +
            (files.length > 40 ? ` ... (+${files.length - 40})` : '')
        )
        addMessage('System', `Mengosongkan repo (${files.length} file) via empty-tree commit...`)
        updateAgent('coder', { status: 'working', currentTask: 'Empty tree...' })
        updateAgent('security', { status: 'working', currentTask: 'Audit hapus...' })
        let deleted: string[] = []
        let errors: string[] = []
        try {
          await emptyRepoBranch(cfgNow, `Virtual Office AI: hapus semua ${files.length} file`)
          deleted = files
          addMessage('System', 'Empty-tree commit berhasil.')
        } catch (e1: unknown) {
          addMessage('System', 'Empty-tree gagal: ' + (e1 instanceof Error ? e1.message : String(e1)) + ' — fallback...')
          const r = await deleteManyFiles(cfgNow, files, 'Virtual Office AI: hapus')
          deleted = r.deleted
          errors = r.errors
        }
        updateAgent('security', { status: 'done', lastMessage: `Audit: ${deleted.length} dihapus`, currentTask: 'Selesai' })
        if (deleted.length) {
          addMessage('System', `Berhasil dihapus (${deleted.length})`)
        }
        if (errors.length) {
          addMessage('System', `Gagal hapus (${errors.length}): ${errors.slice(0, 8).join('; ')}`)
        }
        const remaining = await listRepoFiles(cfgNow, 500)
        updateAgent('manager', {
          status: 'done',
          lastMessage: `Dihapus ${deleted.length}, sisa ${remaining.length}`,
          currentTask: 'Selesai',
        })
        updateAgent('coder', { status: 'done', lastMessage: `Hapus ${deleted.length} file`, currentTask: 'Selesai' })
        addMessage(
          'System',
          `Selesai hapus massal di ${ghNow.repoFullName}. Terhapus: ${deleted.length}. Sisa file: ${remaining.length}${remaining.length ? ' → ' + remaining.slice(0, 15).join(', ') : ' (repo kosong).'}`
        )
      } catch (e: unknown) {
        addMessage('System', 'Gagal hapus massal: ' + (e instanceof Error ? e.message : String(e)))
        updateAgent('manager', { status: 'error', lastMessage: 'Gagal hapus', currentTask: 'Error' })
      } finally {
        set({ isRunning: false })
        setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 4000)
      }
      return
    }

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) {
        addArtifacts(
          artifacts.map((a) => ({
            filename: a.filename,
            language: a.language,
            content: a.content,
            agentId,
            action: a.action,
          }))
        )
      }
    }
    const contextBlock = projectContext
      ? `\n\n## REPO: ${github.repoFullName} (${github.branch})\n${projectContext.slice(0, 3500)}`
      : `\n\n## REPO: ${github.repoFullName}`
    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan...' })
      const plan = await callLLM(
        config,
        `Kamu Budi, PM. Bahasa Indonesia. Target: ${github.repoFullName}. Libatkan Security (Doni). Format: ## Analisis ## Rencana ## Penugasan ## File ## Keamanan.`,
        userTask + contextBlock,
        900
      )
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      addMessage('System', 'Jeda anti rate-limit (14 dtk)...')
      await paceBetweenAgents(14000)

      const workers = [
        {
          id: 'coder',
          name: 'Andi',
          system: `Kamu Andi, Software Engineer. Repo ${github.repoFullName}. Format: \`\`\`html:index.html ... \`\`\``,
        },
        {
          id: 'researcher',
          name: 'Siti',
          system: `Kamu Siti. Output \`\`\`md:docs/analysis.md\`\`\``,
        },
        {
          id: 'writer',
          name: 'Rina',
          system: `Kamu Rina. Output \`\`\`md:README.md\`\`\``,
        },
        {
          id: 'security',
          name: 'Doni',
          system: `Kamu Doni, Security Analyst. Repo ${github.repoFullName}. Audit XSS, injection, secret, auth, CORS. Output: \`\`\`md:docs/security-review.md\n# Security Review\n## Temuan\n## Risiko\n## Rekomendasi\n\`\`\` Bahasa Indonesia.`,
        },
      ]
      const results: string[] = []
      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) {
          addMessage('System', 'Menunggu sebentar agar tidak rate-limit...')
          await paceBetweenAgents(14000)
        }
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const result = await callLLM(
            config,
            w.system,
            `Tugas:\n${userTask.slice(0, 1500)}\n\nRencana:\n${plan.slice(0, 2000)}${contextBlock}`,
            1200
          )
          results.push(`### ${w.name}\n${result}`)
          collectFrom(w.id, result)
          updateAgent(w.id, { status: 'done', lastMessage: result.slice(0, 80) + '...', currentTask: 'Selesai' })
          addMessage(w.name, result)
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          updateAgent(w.id, { status: 'error', lastMessage: msg, currentTask: 'Error' })
          addMessage(w.name, 'Error: ' + msg)
        }
      }

      addMessage('System', 'Jeda sebelum laporan akhir...')
      await paceBetweenAgents(12000)
      updateAgent('manager', { status: 'thinking', currentTask: 'Laporan...' })
      const summary = await callLLM(
        config,
        'Kamu Budi. Laporan singkat + status keamanan (Bahasa Indonesia).',
        `Tugas: ${userTask.slice(0, 800)}\n\n${results.join('\n').slice(0, 4000)}`,
        800
      )
      collectFrom('manager', summary)
      updateAgent('manager', { status: 'done', lastMessage: summary.slice(0, 80) + '...', currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary)
      if (github.autoPush && get().artifacts.length > 0) {
        addMessage('System', 'Auto-push aktif — commit ke GitHub...')
        try {
          await get().pushArtifactsToGithub()
        } catch (e: unknown) {
          addMessage('System', 'Auto-push gagal: ' + (e instanceof Error ? e.message : String(e)))
        }
      } else if (get().artifacts.length > 0) {
        addMessage('System', 'File siap. Aktifkan Auto-push atau klik Push GitHub.')
      }
    } catch (e: unknown) {
      addMessage('System', 'Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 5000)
    }
  },

  pushArtifactsToGithub: async () => {
    const { github, artifacts, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) throw new Error('Repo belum dipilih')
    if (!artifacts.length) throw new Error('Tidak ada file')
    set({ isPushing: true })
    try {
      const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
      const { ok, errors, deleted } = await pushMany(
        cfg,
        artifacts.map((a) => ({
          path: a.filename.replace(/^\/+/, ''),
          content: a.content,
          action: a.action || 'upsert',
        })),
        'Virtual Office AI'
      )
      const parts: string[] = []
      if (ok.length) parts.push('Update/tambah: ' + ok.join(', '))
      if (deleted?.length) parts.push('Hapus: ' + deleted.join(', '))
      if (parts.length) {
        addMessage('System', `Push ke ${github.repoFullName}\n${parts.join('\n')}\nhttps://github.com/${github.owner}/${github.repo}`)
      }
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally {
      set({ isPushing: false })
    }
  },
}))
