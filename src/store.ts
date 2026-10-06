import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo } from './types'
import { callLLM, callLLMMulti, callLLMEnsemble, extractArtifacts, paceBetweenAgents } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, listRepoFiles, deleteManyFiles, emptyRepoBranch, type GitHubConfig } from './github'
import {
  type ConnectorConfig, defaultConnectors, saveConnectors, connectorsStatus,
  executeConnectorActions, handleGmailOAuthCallback, startGmailOAuth,
} from './connectors'
import { searchOnline, needsOnlineResearch, buildResearchQueries } from './websearch'
import { deployToVercel } from './vercel'

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
  return [/hapus\s+semua/, /delete\s+all/, /kosongkan\s+repo/, /bersihkan\s+repo/, /wipe\s+repo/, /clear\s+repo/].some((p) => p.test(t))
}

function detectRepoNameInTask(task: string): string | null {
  const m = task.match(/repo(?:sitory)?\s+([a-zA-Z0-9_.\/-]+)/i)
  return m ? m[1].trim() : null
}

interface Store {
  agents: Agent[]; messages: Message[]; artifacts: Artifact[]; config: AppConfig; github: GitHubSettings
  repos: RepoInfo[]; projectContext: string; isRunning: boolean; isPushing: boolean; isLoadingRepos: boolean
  isCreatingRepo: boolean; connectors: ConnectorConfig; powerMode: boolean
  setConnectors: (c: Partial<ConnectorConfig>) => void; setPowerMode: (v: boolean) => void
  initOAuthCallback: () => Promise<void>; connectGmail: () => Promise<void>
  setConfig: (c: Partial<AppConfig>) => void; setGithub: (g: Partial<GitHubSettings>) => void
  connectWithToken: () => Promise<void>; selectRepo: (fullName: string) => Promise<void>
  createNewRepo: (name: string, opts?: { description?: string; private?: boolean }) => Promise<void>
  loadContext: () => Promise<void>; updateAgent: (id: string, patch: Partial<Agent>) => void
  addMessage: (from: string, text: string) => void
  addArtifacts: (list: Omit<Artifact, 'id' | 'createdAt'>[]) => void; clearArtifacts: () => void
  runTask: (userTask: string) => Promise<void>; pushArtifactsToGithub: () => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  agents: defaultAgents, messages: [], artifacts: [], repos: [], projectContext: '',
  isRunning: false, isPushing: false, isLoadingRepos: false, isCreatingRepo: false,
  connectors: defaultConnectors(),
  powerMode: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_power') !== '0' : true,
  config: {
    apiKey: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_api_key') || '' : '',
    baseUrl: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_base_url') || 'https://api.groq.com/openai/v1' : 'https://api.groq.com/openai/v1',
    model: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model') || 'openai/gpt-oss-20b' : 'openai/gpt-oss-20b',
    apiKey2: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_api_key2') || '' : '',
    baseUrl2: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_base_url2') || 'https://openrouter.ai/api/v1' : 'https://openrouter.ai/api/v1',
    model2: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model2') || 'google/gemini-2.0-flash-exp:free' : 'google/gemini-2.0-flash-exp:free',
    vercelToken: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_vercel_token') || '' : '',
  },
  github: loadGH(),

  setConfig: (c) => set((s) => {
    const next = { ...s.config, ...c }
    if (typeof localStorage !== 'undefined') {
      if (c.apiKey !== undefined) localStorage.setItem('vo_api_key', c.apiKey)
      if (c.baseUrl !== undefined) localStorage.setItem('vo_base_url', c.baseUrl)
      if (c.model !== undefined) localStorage.setItem('vo_model', c.model)
      if (c.apiKey2 !== undefined) localStorage.setItem('vo_api_key2', c.apiKey2)
      if (c.baseUrl2 !== undefined) localStorage.setItem('vo_base_url2', c.baseUrl2)
      if (c.model2 !== undefined) localStorage.setItem('vo_model2', c.model2)
      if (c.vercelToken !== undefined) localStorage.setItem('vo_vercel_token', c.vercelToken)
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

  setConnectors: (c) => set((s) => { saveConnectors(c); return { connectors: { ...s.connectors, ...c } } }),
  setPowerMode: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('vo_power', v ? '1' : '0'); set({ powerMode: v }) },

  initOAuthCallback: async () => {
    try {
      const result = await handleGmailOAuthCallback()
      if (result) { get().setConnectors(result); get().addMessage('System', `Gmail terhubung${result.gmailEmail ? ': ' + result.gmailEmail : ''}`) }
    } catch (e: unknown) { get().addMessage('System', 'OAuth Gmail gagal: ' + (e instanceof Error ? e.message : String(e))) }
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
      set({ repos }); setGithub({ connected: true, username })
      addMessage('System', `Login @${username}. ${repos.length} repository.`)
      const match = repos.find((r) => r.full_name === github.repoFullName) || repos[0]
      if (match) await get().selectRepo(match.full_name)
    } finally { set({ isLoadingRepos: false }) }
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
      addMessage('System', `Repo baru: ${repo.full_name}`); set({ projectContext: '' })
    } finally { set({ isCreatingRepo: false }) }
  },

  loadContext: async () => {
    const { github, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) return
    const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
    try {
      const ctx = await loadProjectContext(cfg)
      set({ projectContext: ctx })
      addMessage('System', ctx ? `Konteks dimuat (${Math.round(ctx.length / 100) / 10}k).` : 'Repo kosong.')
    } catch (e: unknown) { addMessage('System', `Gagal konteks: ${e instanceof Error ? e.message : String(e)}`) }
  },

  updateAgent: (id, patch) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  addMessage: (from, text) => set((s) => ({ messages: [...s.messages.slice(-120), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }] })),
  addArtifacts: (list) => set((s) => ({ artifacts: [...s.artifacts, ...list.map((a) => ({ ...a, id: crypto.randomUUID(), createdAt: Date.now() }))] })),
  clearArtifacts: () => set({ artifacts: [] }),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts, github, repos } = get()
    if (get().isRunning) return
    if (!github.connected || !github.repo) { addMessage('System', 'Pilih repository GitHub dulu.'); return }
    set({ isRunning: true }); clearArtifacts(); addMessage('Kamu', userTask)

    const mentioned = detectRepoNameInTask(userTask)
    if (mentioned) {
      const match = repos.find((r) => r.full_name.toLowerCase() === mentioned.toLowerCase()) || repos.find((r) => r.name.toLowerCase() === mentioned.toLowerCase())
      if (match && match.full_name !== github.repoFullName) {
        try { await get().selectRepo(match.full_name) } catch (e: unknown) { addMessage('System', 'Gagal pilih repo: ' + (e instanceof Error ? e.message : String(e))) }
      }
    }

    const ghNow = get().github
    const cfgNow: GitHubConfig = { token: ghNow.token, owner: ghNow.owner, repo: ghNow.repo, branch: ghNow.branch || 'main' }

    if (detectBulkDeleteAll(userTask)) {
      try {
        const files = await listRepoFiles(cfgNow, 500)
        if (!files.length) { addMessage('System', 'Repo sudah kosong.'); set({ isRunning: false }); return }
        await emptyRepoBranch(cfgNow, `VO AI: hapus ${files.length} file`)
        addMessage('System', `Terhapus ${files.length} file.`)
      } catch (e: unknown) { addMessage('System', 'Gagal hapus: ' + (e instanceof Error ? e.message : String(e))) }
      finally { set({ isRunning: false }) }
      return
    }

    try { addMessage('System', 'Memuat konteks repo...'); await get().loadContext() } catch { /* */ }

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) addArtifacts(artifacts.map((a) => ({ filename: a.filename, language: a.language, content: a.content, agentId, action: a.action })))
    }

    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan...' })
      const power = get().powerMode
      const pace = power ? 10000 : 14000
      const tok = power ? 2200 : 1200
      const ctx = get().projectContext
      const richContext = ctx ? `\n\n## REPO: ${github.repoFullName}\n${ctx.slice(0, power ? 8000 : 3500)}` : `\n\n## REPO: ${github.repoFullName}`
      const connInfo = connectorsStatus(get().connectors)

      let researchBlock = ''
      if (needsOnlineResearch(userTask) || /online|hosting|deploy|vercel/i.test(userTask) || power) {
        addMessage('System', '🔍 Riset online gratis (tanpa API key)...')
        updateAgent('researcher', { status: 'working', currentTask: 'Riset online...' })
        const chunks: string[] = []
        for (const q of buildResearchQueries(userTask)) {
          try { chunks.push((await searchOnline(q)).text) } catch (se: unknown) { chunks.push('Riset: ' + (se instanceof Error ? se.message : String(se))) }
        }
        researchBlock = '\n\n' + chunks.join('\n\n').slice(0, 6000)
        addMessage('Siti (Research)', researchBlock.slice(0, 1200) + '…')
        updateAgent('researcher', { status: 'done', lastMessage: 'Riset OK', currentTask: 'Selesai' })
      }

      const planSystem = `Kamu Budi, PM otonom. Bahasa Indonesia. Repo: ${github.repoFullName}. Konektor: ${connInfo}.
OTONOMI: lengkapi brief singkat; pilih stack sendiri; jika perlu online prioritaskan hosting GRATIS (Vercel/Netlify/GitHub Pages); default index.html+styles.css+app.js+README siap deploy.
Format: ## Analisis ## Keputusan hosting ## Rencana ## File ## Penugasan`

      let plan: string; let planUsed = config.model
      try {
        if (config.apiKey2 && power) {
          addMessage('System', '🧠 Multi-API: dua model berpikir...')
          const ens = await callLLMEnsemble(config, planSystem, userTask + richContext + researchBlock, 1400)
          plan = ens.text; planUsed = ens.used
        } else {
          const one = await callLLMMulti(config, planSystem, userTask + richContext + researchBlock, power ? 1400 : 900)
          plan = one.text; planUsed = one.used
        }
      } catch { plan = await callLLM(config, planSystem, userTask + richContext + researchBlock, 900) }
      addMessage('System', `Model rencana: ${planUsed}`)
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      await paceBetweenAgents(pace)

      const workers = [
        { id: 'coder', name: 'Andi', system: `Kamu Andi, Full-Stack. Repo ${github.repoFullName}. SIAP PAKAI + siap deploy static.
WAJIB: \`\`\`html:index.html \`\`\`css:styles.css \`\`\`js:app.js — lengkap, data contoh, tanpa secret, jangan output-coder-*.` },
        { id: 'researcher', name: 'Siti', system: `Kamu Siti. Output \`\`\`md:docs/analysis.md — fitur, data model, hosting. Bahasa Indonesia.` },
        { id: 'writer', name: 'Rina', system: `Kamu Rina. Output \`\`\`md:README.md — cara buka lokal + cara online (Vercel).` },
        { id: 'security', name: 'Doni', system: `Kamu Doni. Output \`\`\`md:docs/security-review.md — temuan & perbaikan.` },
      ]

      const results: string[] = []
      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) { addMessage('System', 'Jeda anti rate-limit...'); await paceBetweenAgents(pace) }
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const prior = results.length ? `\n\n## Sebelumnya:\n${results.join('\n').slice(-3500)}` : ''
          const out = await callLLMMulti(config, w.system, `Tugas:\n${userTask.slice(0, 2500)}\n\nRencana:\n${plan.slice(0, 3000)}${richContext}${researchBlock.slice(0, 2000)}${prior}`, tok)
          const result = out.text
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

      await paceBetweenAgents(Math.max(8000, pace - 2000))
      const summary = await callLLMMulti(config, 'Kamu Budi. Laporan: file + cara pakai online (Bahasa Indonesia).', `Tugas: ${userTask.slice(0, 800)}\n${results.join('\n').slice(0, 5000)}`, 900)
      collectFrom('manager', summary.text)
      updateAgent('manager', { status: 'done', lastMessage: summary.text.slice(0, 80) + '...', currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary.text)

      try {
        const connLogs = await executeConnectorActions(get().connectors, results.join('\n') + '\n' + summary.text)
        for (const line of connLogs) addMessage('System', '🔌 ' + line)
      } catch (ce: unknown) { addMessage('System', 'Konektor: ' + (ce instanceof Error ? ce.message : String(ce))) }

      if (github.autoPush && get().artifacts.length > 0) {
        addMessage('System', 'Auto-push...')
        try { await get().pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', 'Push gagal: ' + (e instanceof Error ? e.message : String(e))) }
      }

      const arts = get().artifacts.filter((a) => a.action !== 'delete')
      if (config.vercelToken && arts.some((a) => /\.html$/i.test(a.filename))) {
        addMessage('System', '🚀 Deploy Vercel (gratis)...')
        try {
          const dep = await deployToVercel({ token: config.vercelToken, name: github.repo || 'vo-app', files: arts.map((a) => ({ path: a.filename, content: a.content })) })
          addMessage('System', `Online: ${dep.url}`)
        } catch (ve: unknown) { addMessage('System', 'Vercel: ' + (ve instanceof Error ? ve.message : String(ve))) }
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
      const { ok, errors, deleted } = await pushMany(cfg, artifacts.map((a) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content, action: a.action || 'upsert' })), 'Virtual Office AI')
      const parts: string[] = []
      if (ok.length) parts.push('Update: ' + ok.join(', '))
      if (deleted?.length) parts.push('Hapus: ' + deleted.join(', '))
      if (parts.length) addMessage('System', parts.join('\n'))
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally { set({ isPushing: false }) }
  },
}))
