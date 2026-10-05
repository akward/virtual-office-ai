import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message } from './types'
import { callLLM, extractArtifacts } from './llm'
import { loadProjectContext, pushMany, testConnection, type GitHubConfig } from './github'

const defaultAgents: Agent[] = [
  { id: 'manager', name: 'Budi', role: 'Project Manager', color: '#3b82f6', emoji: '👔', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 18, y: 42 },
  { id: 'coder', name: 'Andi', role: 'Software Engineer', color: '#22c55e', emoji: '💻', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 42, y: 38 },
  { id: 'researcher', name: 'Siti', role: 'Researcher', color: '#a855f7', emoji: '🔍', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 66, y: 42 },
  { id: 'writer', name: 'Rina', role: 'Content Writer', color: '#f59e0b', emoji: '✍️', status: 'idle', currentTask: '', lastMessage: 'Siap!', x: 30, y: 68 },
]

function loadGH(): GitHubSettings {
  if (typeof localStorage === 'undefined') return { token: '', owner: '', repo: '', branch: 'main', connected: false, repoFullName: '' }
  return {
    token: localStorage.getItem('vo_gh_token') || '',
    owner: localStorage.getItem('vo_gh_owner') || '',
    repo: localStorage.getItem('vo_gh_repo') || '',
    branch: localStorage.getItem('vo_gh_branch') || 'main',
    connected: localStorage.getItem('vo_gh_connected') === '1',
    repoFullName: localStorage.getItem('vo_gh_fullname') || '',
  }
}

interface Store {
  agents: Agent[]
  messages: Message[]
  artifacts: Artifact[]
  config: AppConfig
  github: GitHubSettings
  projectContext: string
  isRunning: boolean
  isPushing: boolean
  setConfig: (c: Partial<AppConfig>) => void
  setGithub: (g: Partial<GitHubSettings>) => void
  connectGithub: () => Promise<void>
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
  projectContext: '',
  isRunning: false,
  isPushing: false,
  config: {
    apiKey: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_api_key') || '' : '',
    baseUrl: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_base_url') || 'https://api.groq.com/openai/v1' : 'https://api.groq.com/openai/v1',
    model: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model') || 'llama-3.3-70b-versatile' : 'llama-3.3-70b-versatile',
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
    }
    return { github: next }
  }),

  connectGithub: async () => {
    const { github, setGithub, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) throw new Error('Isi Token, Owner, dan Repo')
    const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
    const full = await testConnection(cfg)
    setGithub({ connected: true, repoFullName: full })
    addMessage('System', `Terhubung: ${full} (${cfg.branch})`)
    await get().loadContext()
  },

  loadContext: async () => {
    const { github, addMessage } = get()
    if (!github.connected || !github.token) return
    const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
    try {
      const ctx = await loadProjectContext(cfg)
      set({ projectContext: ctx })
      addMessage('System', ctx ? `Konteks project dimuat (${ctx.length} karakter).` : 'Repo tanpa file umum.')
    } catch (e: unknown) {
      addMessage('System', `Gagal konteks: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  updateAgent: (id, patch) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  addMessage: (from, text) => set((s) => ({ messages: [...s.messages.slice(-80), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }] })),
  addArtifacts: (list) => set((s) => ({ artifacts: [...s.artifacts, ...list.map((a) => ({ ...a, id: crypto.randomUUID(), createdAt: Date.now() }))] })),
  clearArtifacts: () => set({ artifacts: [] }),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts, projectContext, github } = get()
    if (get().isRunning) return
    set({ isRunning: true })
    clearArtifacts()
    addMessage('Kamu', userTask)
    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) addArtifacts(artifacts.map((a) => ({ filename: a.filename, language: a.language, content: a.content, agentId })))
    }
    const contextBlock = projectContext
      ? `\n\n## KONTEKS GITHUB (${github.repoFullName})\nEdit project ini:\n${projectContext.slice(0, 8000)}`
      : ''
    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan...' })
      const plan = await callLLM(config, `Kamu Budi, PM. Bahasa Indonesia. ${github.connected ? 'Edit file GitHub yang ada.' : ''}\nFormat: ## Analisis ## Rencana ## Penugasan ## File`, userTask + contextBlock, 1200)
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      const workers = [
        { id: 'coder', name: 'Andi', system: 'Kamu Andi, Engineer. WAJIB output ```bahasa:path/file.ext\nkode\n``` Path nested OK. Bahasa Indonesia.' },
        { id: 'researcher', name: 'Siti', system: 'Kamu Siti, Researcher. Output ```markdown:docs/analysis.md\n...``` Bahasa Indonesia.' },
        { id: 'writer', name: 'Rina', system: 'Kamu Rina, Writer. Output ```markdown:README.md\n...``` Bahasa Indonesia.' },
      ]
      const results: string[] = []
      for (const w of workers) {
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const result = await callLLM(config, w.system, `Tugas:\n${userTask}\n\nRencana:\n${plan}${contextBlock}\n\nWAJIB code block path file.`, 3000)
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
      updateAgent('manager', { status: 'thinking', currentTask: 'Laporan...' })
      const summary = await callLLM(config, 'Kamu Budi. Laporan singkat + daftar file.', `Tugas: ${userTask}\n\n${results.join('\n').slice(0, 7000)}`, 1500)
      collectFrom('manager', summary)
      updateAgent('manager', { status: 'done', lastMessage: summary.slice(0, 80) + '...', currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary)
      if (github.connected) addMessage('System', 'Klik Push ke GitHub di tab File untuk commit.')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addMessage('System', 'Error: ' + msg)
    } finally {
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 5000)
    }
  },

  pushArtifactsToGithub: async () => {
    const { github, artifacts, addMessage } = get()
    if (!github.connected || !github.token) throw new Error('Hubungkan GitHub dulu')
    if (!artifacts.length) throw new Error('Tidak ada file')
    set({ isPushing: true })
    try {
      const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
      const { ok, errors } = await pushMany(cfg, artifacts.map((a) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content })), 'Virtual Office AI')
      if (ok.length) addMessage('System', `Push OK (${ok.length}): ${ok.join(', ')}\nhttps://github.com/${github.owner}/${github.repo}`)
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally {
      set({ isPushing: false })
    }
  },
}))
