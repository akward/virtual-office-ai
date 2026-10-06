import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo } from './types'
import { callLLM, extractArtifacts, paceBetweenAgents } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, listRepoFiles, deleteManyFiles, emptyRepoBranch, type GitHubConfig } from './github'
import {
  type ConnectorConfig,
  defaultConnectors,
  saveConnectors,
  connectorsStatus,
  executeConnectorActions,
  handleGmailOAuthCallback,
  startGmailOAuth,
} from './connectors'

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
  return [
    /hapus\s+semua\s+file/, /hapus\s+seluruh\s+file/, /hapus\s+semua\s+isi/, /hapus\s+semua/,
    /delete\s+all\s+files?/, /remove\s+all\s+files?/, /kosongkan\s+(repo|repository)/,
    /bersihkan\s+(semua\s+)?(isi\s+)?repo/, /bersihkan\s+repo/, /wipe\s+(the\s+)?repo/,
    /clear\s+(the\s+)?repo/, /hapus\s+semua\s+output/, /hapus\s+file\s+output/,
  ].some((p) => p.test(t))
}

function detectRepoNameInTask(task: string): string | null {
  const m =
    task.match(/repo(?:sitory)?\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i) ||
    task.match(/repo(?:sitory)?\s+([a-zA-Z0-9_.-]+)/i) ||
    task.match(/di\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i)
  return m ? m[1].trim() : null
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
  connectors: ConnectorConfig
  powerMode: boolean
  setConnectors: (c: Partial<ConnectorConfig>) => void
  setPowerMode: (v: boolean) => void
  initOAuthCallback: () => Promise<void>
  connectGmail: () => Promise<void>
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
  connectors: defaultConnectors(),
  powerMode: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_power') !== '0' : true,
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

  setConnectors: (c) => set((s) => {
    saveConnectors(c)
    return { connectors: { ...s.connectors, ...c } }
  }),

  setPowerMode: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('vo_power', v ? '1' : '0')
    set({ powerMode: v })
  },

  initOAuthCallback: async () => {
    try {
      const result = await handleGmailOAuthCallback()
      if (result) {
        get().setConnectors(result)
        get().addMessage('System', `Gmail terhubung${result.gmailEmail ? ': ' + result.gmailEmail : ''}`)
      }
    } catch (e: unknown) {
      get().addMessage('System', 'OAuth Gmail gagal: ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  connectGmail: async () => {
    const { connectors } = get()
    if (!connectors.gmailClientId.trim()) throw new Error('Isi Google OAuth Client ID')
    await startGmailOAuth(connectors.gmailClientId)
  },

  connectWithToken: async () => {
    const { github, setGithub, addMessage } = get()
    if (!github.token.trim()) throw new Error('Isi GitHub token')
    set({ isLoadingRepos: true })
    try {
      const username = await getAuthenticatedUser(github.token)
      const repos = await listAllRepos(github.token)
      set({ repos })
      setGithub({ connected: true, username })
      addMessage('System', `Login @${username}. ${repos.length} repository.`)
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
    addMessage('System', `Repo aktif: ${r.full_name}`)
    await get().loadContext()
  },

  createNewRepo: async (name: string, opts?: { description?: string; private?: boolean }) => {
    const { github, addMessage, setGithub } = get()
    if (!github.token.trim()) throw new Error('Isi GitHub token')
    set({ isCreatingRepo: true })
    try {
      const repo = await createRepo(github.token, name.trim(), { description: opts?.description, private: opts?.private ?? false, auto_init: true })
      set((s) => ({ repos: [repo, ...s.repos.filter((r) => r.full_name !== repo.full_name)] }))
      setGithub({ connected: true, username: github.username || repo.owner, owner: repo.owner, repo: repo.name, branch: repo.default_branch || 'main', repoFullName: repo.full_name })
      addMessage('System', `Repo baru: ${repo.full_name}\n${repo.html_url}`)
      set({ projectContext: '' })
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
      addMessage('System', ctx ? `Konteks dimuat (${Math.round(ctx.length / 100) / 10}k).` : 'Repo kosong.')
    } catch (e: unknown) {
      addMessage('System', `Gagal konteks: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  updateAgent: (id, patch) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  addMessage: (from, text) => set((s) => ({ messages: [...s.messages.slice(-120), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }] })),
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
      const match = repos.find((r) => r.full_name.toLowerCase() === mentioned.toLowerCase()) || repos.find((r) => r.name.toLowerCase() === mentioned.toLowerCase())
      if (match && match.full_name !== github.repoFullName) {
        try { await get().selectRepo(match.full_name) } catch (e: unknown) {
          addMessage('System', 'Gagal pilih repo: ' + (e instanceof Error ? e.message : String(e)))
        }
      }
    }

    const ghNow = get().github
    const cfgNow: GitHubConfig = { token: ghNow.token, owner: ghNow.owner, repo: ghNow.repo, branch: ghNow.branch || 'main' }

    if (detectBulkDeleteAll(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: 'Hapus semua...' })
      try {
        const files = await listRepoFiles(cfgNow, 500)
        if (!files.length) {
          addMessage('System', 'Repo sudah kosong.')
          set({ isRunning: false })
          return
        }
        await emptyRepoBranch(cfgNow, `Virtual Office AI: hapus ${files.length} file`)
        addMessage('System', `Terhapus ${files.length} file (empty tree).`)
      } catch (e: unknown) {
        try {
          const files = await listRepoFiles(cfgNow, 500)
          const r = await deleteManyFiles(cfgNow, files, 'VO AI hapus')
          addMessage('System', `Fallback hapus: ${r.deleted.length}. Err: ${r.errors.slice(0, 2).join('; ')}`)
        } catch (e2: unknown) {
          addMessage('System', 'Gagal hapus: ' + (e2 instanceof Error ? e2.message : String(e2)))
        }
      } finally {
        set({ isRunning: false })
      }
      return
    }

    try {
      addMessage('System', 'Memuat ulang konteks repo...')
      await get().loadContext()
    } catch { /* ignore */ }

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) {
        addArtifacts(artifacts.map((a) => ({
          filename: a.filename, language: a.language, content: a.content, agentId, action: a.action,
        })))
      }
    }

    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan full-power...' })
      const power = get().powerMode
      const pace = power ? 10000 : 14000
      const tok = power ? 2200 : 1200
      const ctxLimit = power ? 8000 : 3500
      const ctx = get().projectContext
      const richContext = ctx
        ? `\n\n## REPO: ${github.repoFullName} (${github.branch})\n${ctx.slice(0, ctxLimit)}`
        : `\n\n## REPO: ${github.repoFullName}`
      const connInfo = connectorsStatus(get().connectors)

      const plan = await callLLM(
        config,
        `Kamu Budi, PM senior full power. Bahasa Indonesia. Repo: ${github.repoFullName}.
Konektor: ${connInfo}.
Aturan: pecah tugas ke Coder/Researcher/Writer/Security; path file jelas; SEND_EMAIL/TELEGRAM/SLACK jika perlu; DELETE: path untuk sampah.
Mode ${power ? 'FULL POWER: arsitektur, edge case, keamanan' : 'standar'}.
Format: ## Analisis ## Arsitektur ## Rencana ## Penugasan ## File ## Keamanan ## Notifikasi`,
        userTask + richContext,
        power ? 1400 : 900
      )
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      addMessage('System', `Mode ${power ? 'FULL POWER ⚡' : 'standar'} · jeda ${pace / 1000}s...`)
      await paceBetweenAgents(pace)

      const workers = [
        {
          id: 'coder', name: 'Andi',
          system: `Kamu Andi, Senior Full-Stack (full power). Repo ${github.repoFullName}.
Kode SIAP PAKAI. Path: \`\`\`html:index.html / \`\`\`css:styles.css / \`\`\`js:app.js
Lengkap, validasi, responsif, tanpa secret. Jangan output-coder-*.
${power ? 'Edge case + UX + komentar arsitektur singkat.' : ''}
DELETE: path untuk sampah. Bahasa Indonesia singkat.`,
        },
        {
          id: 'researcher', name: 'Siti',
          system: `Kamu Siti, Senior Analyst. Output \`\`\`md:docs/analysis.md
Kebutuhan, data model, flow, risiko${power ? ', metrik sukses, acceptance checklist' : ''}. Bahasa Indonesia.`,
        },
        {
          id: 'writer', name: 'Rina',
          system: `Kamu Rina, Tech Writer. Output \`\`\`md:README.md
Deskripsi, cara pakai, struktur, setup${power ? ', troubleshooting, roadmap' : ''}. Bahasa Indonesia.`,
        },
        {
          id: 'security', name: 'Doni',
          system: `Kamu Doni, Security Analyst. Output \`\`\`md:docs/security-review.md
# Security Review\n## Temuan\n## Risiko\n## Perbaikan
XSS, injection, secret, auth, CORS${power ? ', OWASP checklist' : ''}. Bahasa Indonesia.`,
        },
      ]

      const results: string[] = []
      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) {
          addMessage('System', 'Jeda anti rate-limit...')
          await paceBetweenAgents(pace)
        }
        updateAgent(w.id, { status: 'working', currentTask: power ? 'Full power...' : 'Kerja...' })
        try {
          const prior = results.length ? `\n\n## Output agent sebelumnya:\n${results.join('\n').slice(-3500)}` : ''
          const result = await callLLM(
            config,
            w.system,
            `Tugas:\n${userTask.slice(0, 2500)}\n\nRencana Manager:\n${plan.slice(0, 3000)}${richContext}${prior}`,
            tok
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

      addMessage('System', 'Laporan akhir...')
      await paceBetweenAgents(Math.max(8000, pace - 2000))
      updateAgent('manager', { status: 'thinking', currentTask: 'Laporan...' })
      const summary = await callLLM(
        config,
        'Kamu Budi. Laporan eksekutif: hasil, file, keamanan, konektor (Bahasa Indonesia).',
        `Tugas: ${userTask.slice(0, 800)}\n\n${results.join('\n').slice(0, 5000)}`,
        power ? 1000 : 800
      )
      collectFrom('manager', summary)
      updateAgent('manager', { status: 'done', lastMessage: summary.slice(0, 80) + '...', currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary)

      try {
        const connLogs = await executeConnectorActions(get().connectors, results.join('\n') + '\n' + summary)
        for (const line of connLogs) addMessage('System', '🔌 ' + line)
      } catch (ce: unknown) {
        addMessage('System', 'Konektor: ' + (ce instanceof Error ? ce.message : String(ce)))
      }

      if (github.autoPush && get().artifacts.length > 0) {
        addMessage('System', 'Auto-push...')
        try { await get().pushArtifactsToGithub() } catch (e: unknown) {
          addMessage('System', 'Push gagal: ' + (e instanceof Error ? e.message : String(e)))
        }
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
        artifacts.map((a) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content, action: a.action || 'upsert' })),
        'Virtual Office AI'
      )
      const parts: string[] = []
      if (ok.length) parts.push('Update: ' + ok.join(', '))
      if (deleted?.length) parts.push('Hapus: ' + deleted.join(', '))
      if (parts.length) addMessage('System', parts.join('\n'))
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally {
      set({ isPushing: false })
    }
  },
}))
