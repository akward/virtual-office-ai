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

type ConnectTarget = {
  id: string
  label: string
  url: string
  field: 'vercelToken' | 'apiKey' | 'apiKey2' | 'ghToken'
  hint: string
}

function detectConnectTarget(task: string): ConnectTarget | null {
  const t = task.toLowerCase()
  const want = /(sambung|hubung|connect|login|otorisasi|authorize)/i.test(t)
  if (/vercel/i.test(t) && (want || /token/i.test(t))) {
    return {
      id: 'vercel', label: 'Vercel', url: 'https://vercel.com/account/tokens',
      field: 'vercelToken', hint: 'Create Token → copy → tempel di kotak dialog.',
    }
  }
  if (/openrouter/i.test(t)) {
    return {
      id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys',
      field: 'apiKey2', hint: 'Create key → copy → tempel. Jangan bagikan key.',
    }
  }
  if (/github/i.test(t) && want) {
    return {
      id: 'github', label: 'GitHub', url: 'https://github.com/settings/tokens',
      field: 'ghToken', hint: 'Token classic scope repo → copy → tempel.',
    }
  }
  if (/groq/i.test(t) && want) {
    return {
      id: 'groq', label: 'Groq', url: 'https://console.groq.com/keys',
      field: 'apiKey', hint: 'Create API key → copy → tempel.',
    }
  }
  if (/gemini|google\s*ai/i.test(t) && want) {
    return {
      id: 'gemini', label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey',
      field: 'apiKey2', hint: 'Create API key → copy → tempel.',
    }
  }
  return null
}

function openConnectPopup(url: string): Window | null {
  const w = 600, h = 720
  const left = Math.max(0, (window.screen.width - w) / 2)
  const top = Math.max(0, (window.screen.height - h) / 2)
  return window.open(url, 'vo_connect', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
}

async function waitPopupClosedOrFocus(popup: Window | null, maxMs = 180000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve) => {
    const onFocus = () => setTimeout(() => resolve(), 400)
    window.addEventListener('focus', onFocus, { once: true })
    const tick = () => {
      if (popup && popup.closed) { resolve(); return }
      if (Date.now() - start > maxMs) { resolve(); return }
      setTimeout(tick, 600)
    }
    tick()
  })
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
    set({ isRunning: true }); clearArtifacts(); addMessage('Kamu', userTask)

    const connectTarget = detectConnectTarget(userTask)
    if (connectTarget && /(sambung|hubung|connect|login|otorisasi|authorize|token)/i.test(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: `Hubungkan ${connectTarget.label}...` })
      addMessage('Budi (Manager)', `Saya buka halaman ${connectTarget.label}.\n${connectTarget.hint}`)
      addMessage('System', `Membuka ${connectTarget.url} ...`)
      let popup: Window | null = null
      try {
        popup = openConnectPopup(connectTarget.url)
        if (!popup) {
          addMessage('System', 'Popup diblokir. Buka manual: ' + connectTarget.url)
          window.open(connectTarget.url, '_blank')
        }
      } catch { window.open(connectTarget.url, '_blank') }
      await waitPopupClosedOrFocus(popup)
      const token = window.prompt(`Tempel token/API key ${connectTarget.label}:`, '')
      if (token && token.trim()) {
        const val = token.trim()
        if (connectTarget.field === 'vercelToken') {
          get().setConfig({ vercelToken: val })
          addMessage('System', '✅ Vercel terhubung (token di localStorage).')
        } else if (connectTarget.field === 'apiKey') {
          get().setConfig({ apiKey: val })
          addMessage('System', '✅ API Key #1 disimpan.')
        } else if (connectTarget.field === 'apiKey2') {
          const base = connectTarget.id === 'openrouter' ? 'https://openrouter.ai/api/v1' : connectTarget.id === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai' : get().config.baseUrl2
          const model = connectTarget.id === 'openrouter' ? 'google/gemini-2.0-flash-exp:free' : get().config.model2
          get().setConfig({ apiKey2: val, baseUrl2: base, model2: model })
          addMessage('System', `✅ ${connectTarget.label} → API #2.`)
        } else if (connectTarget.field === 'ghToken') {
          get().setGithub({ token: val })
          try { await get().connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
        }
        updateAgent('manager', { status: 'done', lastMessage: `${connectTarget.label} OK`, currentTask: 'Selesai' })
        addMessage('Budi (Manager)', `${connectTarget.label} terhubung. Kirim tugas berikutnya.`)
      } else {
        addMessage('System', `Dibatalkan — token ${connectTarget.label} kosong.`)
      }
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 2500)
      return
    }

    if (!github.connected || !github.repo) {
      addMessage('System', 'Pilih repository GitHub dulu.')
      set({ isRunning: false })
      return
    }

    const mentioned = detectRepoNameInTask(userTask)
    if (mentioned) {
      const match = repos.find((r) => r.full_name.toLowerCase() === mentioned.toLowerCase()) || repos.find((r) => r.name.toLowerCase() === mentioned.toLowerCase())
      if (match && match.full_name !== github.repoFullName) {
        try { await get().selectRepo(match.full_name) } catch (e: unknown) { addMessage('System', String(e)) }
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
        addMessage('System', '🔍 Riset online...')
        for (const q of buildResearchQueries(userTask)) {
          try { researchBlock += '\n' + (await searchOnline(q)).text } catch { /* */ }
        }
        researchBlock = researchBlock.slice(0, 6000)
        if (researchBlock) addMessage('Siti (Research)', researchBlock.slice(0, 1000) + '…')
      }

      const planSystem = `Kamu Budi, PM otonom. Bahasa Indonesia. Repo: ${github.repoFullName}. Konektor: ${connInfo}.
OTONOMI: lengkapi brief; hosting gratis Vercel jika online; default index.html+css+js+README.
Format: ## Analisis ## Hosting ## Rencana ## File ## Penugasan`

      let plan: string
      try {
        if (config.apiKey2 && power) {
          const ens = await callLLMEnsemble(config, planSystem, userTask + richContext + researchBlock, 1400)
          plan = ens.text
          addMessage('System', `Model: ${ens.used}`)
        } else {
          const one = await callLLMMulti(config, planSystem, userTask + richContext + researchBlock, power ? 1400 : 900)
          plan = one.text
        }
      } catch { plan = await callLLM(config, planSystem, userTask + richContext, 900) }

      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 80) + '...', currentTask: 'Instruksi' })
      addMessage('Budi (Manager)', plan)
      await paceBetweenAgents(pace)

      const workers = [
        { id: 'coder', name: 'Andi', system: `Kamu Andi. Repo ${github.repoFullName}. Output \`\`\`html:index.html \`\`\`css:styles.css \`\`\`js:app.js siap pakai + deploy.` },
        { id: 'researcher', name: 'Siti', system: `Kamu Siti. Output \`\`\`md:docs/analysis.md` },
        { id: 'writer', name: 'Rina', system: `Kamu Rina. Output \`\`\`md:README.md` },
        { id: 'security', name: 'Doni', system: `Kamu Doni. Output \`\`\`md:docs/security-review.md` },
      ]
      const results: string[] = []
      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) await paceBetweenAgents(pace)
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const prior = results.length ? `\n\n## Sebelumnya:\n${results.join('\n').slice(-3000)}` : ''
          const out = await callLLMMulti(config, w.system, `Tugas:\n${userTask.slice(0, 2000)}\n\nRencana:\n${plan.slice(0, 2500)}${richContext}${prior}`, tok)
          results.push(`### ${w.name}\n${out.text}`)
          collectFrom(w.id, out.text)
          updateAgent(w.id, { status: 'done', lastMessage: out.text.slice(0, 60) + '...', currentTask: 'Selesai' })
          addMessage(w.name, out.text)
        } catch (e: unknown) {
          addMessage(w.name, 'Error: ' + (e instanceof Error ? e.message : String(e)))
          updateAgent(w.id, { status: 'error', currentTask: 'Error' })
        }
      }

      await paceBetweenAgents(Math.max(8000, pace - 2000))
      const summary = await callLLMMulti(config, 'Kamu Budi. Laporan singkat Bahasa Indonesia.', `Tugas: ${userTask.slice(0, 600)}\n${results.join('\n').slice(0, 4000)}`, 800)
      collectFrom('manager', summary.text)
      addMessage('Budi (Manager)', summary.text)

      try {
        const logs = await executeConnectorActions(get().connectors, results.join('\n') + summary.text)
        for (const line of logs) addMessage('System', '🔌 ' + line)
      } catch { /* */ }

      if (github.autoPush && get().artifacts.length > 0) {
        try { await get().pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', 'Push: ' + (e instanceof Error ? e.message : String(e))) }
      }

      const arts = get().artifacts.filter((a) => a.action !== 'delete')
      if (config.vercelToken && arts.some((a) => /\.html$/i.test(a.filename))) {
        addMessage('System', '🚀 Deploy Vercel...')
        try {
          const dep = await deployToVercel({ token: config.vercelToken, name: github.repo || 'vo-app', files: arts.map((a) => ({ path: a.filename, content: a.content })) })
          addMessage('System', `Online: ${dep.url}`)
        } catch (ve: unknown) { addMessage('System', 'Vercel: ' + (ve instanceof Error ? ve.message : String(ve))) }
      }
    } catch (e: unknown) {
      addMessage('System', 'Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 4000)
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
      if (ok.length) addMessage('System', 'Update: ' + ok.join(', '))
      if (deleted?.length) addMessage('System', 'Hapus: ' + deleted.join(', '))
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally { set({ isPushing: false }) }
  },
}))
