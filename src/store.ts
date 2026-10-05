import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo } from './types'
import { callLLM, extractArtifacts, paceBetweenAgents } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, type GitHubConfig } from './github'

const defaultAgents: Agent[] = [
  { id: 'manager', name: 'Budi', role: 'Project Manager', color: '#3b82f6', emoji: '👔', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 18, y: 42 },
  { id: 'coder', name: 'Andi', role: 'Software Engineer', color: '#22c55e', emoji: '💻', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 42, y: 38 },
  { id: 'researcher', name: 'Siti', role: 'Researcher', color: '#a855f7', emoji: '🔍', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 66, y: 42 },
  { id: 'writer', name: 'Rina', role: 'Content Writer', color: '#f59e0b', emoji: '✍️', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 30, y: 68 },
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
    model: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model') || 'llama-3.1-8b-instant' : 'llama-3.1-8b-instant',
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
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts, projectContext, github } = get()
    if (get().isRunning) return
    if (!github.connected || !github.repo) {
      addMessage('System', 'Pilih repository GitHub dulu.')
      return
    }
    set({ isRunning: true })
    clearArtifacts()
    addMessage('Kamu', userTask)
    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) addArtifacts(artifacts.map((a) => ({ filename: a.filename, language: a.language, content: a.content, agentId })))
    }
    const contextBlock = projectContext
      ? `\n\n## REPO: ${github.repoFullName} (${github.branch})\n${projectContext.slice(0, 3500)}`
      : `\n\n## REPO: ${github.repoFullName}`
    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan...' })
      const plan = await callLLM(config, `Kamu Budi, PM. Bahasa Indonesia. Target: ${github.repoFullName}. Format: ## Analisis ## Rencana ## Penugasan ## File`, userTask + contextBlock, 900)
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      addMessage('System', 'Jeda anti rate-limit (14 dtk)...')
      await paceBetweenAgents(14000)

      const workers = [
        { id: 'coder', name: 'Andi', system: `Kamu Andi, Engineer. Repo ${github.repoFullName}. WAJIB output code block path file. Bahasa Indonesia. Hemat & lengkap.` },
        { id: 'researcher', name: 'Siti', system: 'Kamu Siti. Output singkat markdown:docs/analysis.md' },
        { id: 'writer', name: 'Rina', system: 'Kamu Rina. Output singkat markdown:README.md' },
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
        'Kamu Budi. Laporan singkat + daftar file (Bahasa Indonesia).',
        `Tugas: ${userTask.slice(0, 800)}\n\n${results.join('\n').slice(0, 4000)}`,
        800
      )
      collectFrom('manager', summary)
      updateAgent('manager', { status: 'done', lastMessage: summary.slice(0, 80) + '...', currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary)
      if (github.autoPush && get().artifacts.length > 0) {
        addMessage('System', 'Auto-push aktif — commit ke GitHub...')
        try { await get().pushArtifactsToGithub() } catch (e: unknown) {
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
      const { ok, errors } = await pushMany(cfg, artifacts.map((a) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content })), 'Virtual Office AI')
      if (ok.length) addMessage('System', `Push ke ${github.repoFullName}: ${ok.join(', ')}\nhttps://github.com/${github.owner}/${github.repo}`)
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally {
      set({ isPushing: false })
    }
  },
}))
