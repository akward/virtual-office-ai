import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo, AgentMemory } from './types'
import { callLLM, callLLMMulti, extractArtifacts, paceBetweenAgents } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, listRepoFiles, deleteManyFiles, emptyRepoBranch, getFile, type GitHubConfig } from './github'
import {
  type ConnectorConfig, defaultConnectors, saveConnectors,
  handleGmailOAuthCallback, startGmailOAuth,
} from './connectors'
import { deployToVercel } from './vercel'
import {
  loadMemory, saveMemory, memoryBlock, detectTeachIntent,
  isJunkPath, detectJunkCleanup, detectDeployIntent, detectBulkDeleteAll,
} from './agentMemory'

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

function openConnectPopup(url: string): Window | null {
  const w = 600, h = 720
  const left = Math.max(0, (window.screen.width - w) / 2)
  const top = Math.max(0, (window.screen.height - h) / 2)
  return window.open(url, 'vo_connect', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
}

async function waitPopupClosedOrFocus(popup: Window | null, maxMs = 180000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve) => {
    window.addEventListener('focus', () => setTimeout(() => resolve(), 400), { once: true })
    const tick = () => {
      if (popup && popup.closed) { resolve(); return }
      if (Date.now() - start > maxMs) { resolve(); return }
      setTimeout(tick, 600)
    }
    tick()
  })
}

type ConnectTarget = {
  id: string; label: string; url: string
  field: 'vercelToken' | 'apiKey' | 'apiKey2' | 'ghToken'
  hint: string
}

function detectConnectTarget(task: string): ConnectTarget | null {
  const t = task.toLowerCase()
  const want = /(sambung|hubung|connect|login|otorisasi|authorize)/i.test(t)
  if (/vercel/i.test(t) && (want || /token/i.test(t))) {
    return { id: 'vercel', label: 'Vercel', url: 'https://vercel.com/account/tokens', field: 'vercelToken', hint: 'Full Account token → tempel.' }
  }
  if (/openrouter/i.test(t)) {
    return { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys', field: 'apiKey2', hint: 'Create key → tempel.' }
  }
  if (/github/i.test(t) && want) {
    return { id: 'github', label: 'GitHub', url: 'https://github.com/settings/tokens', field: 'ghToken', hint: 'Token scope repo → tempel.' }
  }
  if (/groq/i.test(t) && want) {
    return { id: 'groq', label: 'Groq', url: 'https://console.groq.com/keys', field: 'apiKey', hint: 'Create API key → tempel.' }
  }
  return null
}

interface Store {
  agents: Agent[]; messages: Message[]; artifacts: Artifact[]; config: AppConfig; github: GitHubSettings
  repos: RepoInfo[]; projectContext: string; isRunning: boolean; isPushing: boolean; isLoadingRepos: boolean
  isCreatingRepo: boolean; connectors: ConnectorConfig; powerMode: boolean; agentMemory: AgentMemory
  setConnectors: (c: Partial<ConnectorConfig>) => void; setPowerMode: (v: boolean) => void
  teachAgent: (lesson: string) => void; clearMemory: () => void
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
  agentMemory: loadMemory(),
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

  teachAgent: (lesson: string) => {
    const text = lesson.trim()
    if (!text) return
    set((s) => {
      const isPref = /^(selalu|jangan|preferensi|gunakan|pakai|bahasa)/i.test(text)
      const next: AgentMemory = isPref
        ? { ...s.agentMemory, prefs: [...s.agentMemory.prefs.filter((p) => p !== text), text].slice(-30) }
        : {
            ...s.agentMemory,
            lessons: [...s.agentMemory.lessons, { id: crypto.randomUUID(), text, createdAt: Date.now() }].slice(-40),
          }
      saveMemory(next)
      return { agentMemory: next }
    })
  },

  clearMemory: () => {
    const empty: AgentMemory = { lessons: [], prefs: [] }
    saveMemory(empty)
    set({ agentMemory: empty })
  },

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
  addMessage: (from, text) => set((s) => ({ messages: [...s.messages.slice(-80), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }] })),
  addArtifacts: (list) => set((s) => ({ artifacts: [...s.artifacts, ...list.map((a) => ({ ...a, id: crypto.randomUUID(), createdAt: Date.now() }))] })),
  clearArtifacts: () => set({ artifacts: [] }),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts, github } = get()
    if (get().isRunning) return
    set({ isRunning: true }); clearArtifacts(); addMessage('Kamu', userTask)

    const teach = detectTeachIntent(userTask)
    if (teach) {
      get().teachAgent(teach)
      addMessage('Budi (Manager)', `Sudah saya ingat:\n« ${teach} »`)
      set({ isRunning: false })
      return
    }

    const connectTarget = detectConnectTarget(userTask)
    if (connectTarget && /(sambung|hubung|connect|login|otorisasi|authorize|token)/i.test(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: `Hubungkan ${connectTarget.label}...` })
      addMessage('Budi (Manager)', `Buka ${connectTarget.label}: ${connectTarget.hint}`)
      let popup: Window | null = null
      try {
        popup = openConnectPopup(connectTarget.url)
        if (!popup) window.open(connectTarget.url, '_blank')
      } catch { window.open(connectTarget.url, '_blank') }
      await waitPopupClosedOrFocus(popup)
      const token = window.prompt(`Tempel token ${connectTarget.label}:`, '')
      if (token?.trim()) {
        const val = token.trim()
        if (connectTarget.field === 'vercelToken') get().setConfig({ vercelToken: val })
        else if (connectTarget.field === 'apiKey') get().setConfig({ apiKey: val })
        else if (connectTarget.field === 'apiKey2') {
          get().setConfig({
            apiKey2: val,
            baseUrl2: connectTarget.id === 'openrouter' ? 'https://openrouter.ai/api/v1' : get().config.baseUrl2,
            model2: connectTarget.id === 'openrouter' ? 'google/gemini-2.0-flash-exp:free' : get().config.model2,
          })
        } else if (connectTarget.field === 'ghToken') {
          get().setGithub({ token: val })
          try { await get().connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
        }
        addMessage('System', `✅ ${connectTarget.label} tersimpan.`)
      } else addMessage('System', 'Dibatalkan.')
      set({ isRunning: false })
      return
    }

    if (!github.connected || !github.repo) {
      addMessage('System', 'Pilih repository GitHub dulu.')
      set({ isRunning: false })
      return
    }

    const ghNow = get().github
    const cfgNow: GitHubConfig = { token: ghNow.token, owner: ghNow.owner, repo: ghNow.repo, branch: ghNow.branch || 'main' }

    if (detectJunkCleanup(userTask) && !detectBulkDeleteAll(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: 'Bersihkan sampah...' })
      try {
        const all = await listRepoFiles(cfgNow, 500)
        const junk = all.filter(isJunkPath)
        if (!junk.length) {
          addMessage('Budi (Manager)', 'Tidak ada file sampah.')
          set({ isRunning: false })
          return
        }
        addMessage('Budi (Manager)', `Menghapus ${junk.length} file sampah.`)
        const result = await deleteManyFiles(cfgNow, junk, 'Hapus file sampah')
        if (result.deleted.length) addMessage('System', `✅ Terhapus (${result.deleted.length})`)
        if (result.errors.length) addMessage('System', `Gagal: ${result.errors.slice(0, 5).join('; ')}`)
        addMessage('Budi (Manager)', 'Selesai.')
      } catch (e: unknown) {
        addMessage('System', 'Gagal: ' + (e instanceof Error ? e.message : String(e)))
      } finally { set({ isRunning: false }) }
      return
    }

    if (detectDeployIntent(userTask)) {
      updateAgent('manager', { status: 'working', currentTask: 'Deploy...' })
      if (!get().config.vercelToken) {
        try { window.open('https://vercel.com/account/tokens', 'vo_connect', 'popup=yes,width=600,height=720') } catch { /* */ }
        const tok = window.prompt('Tempel Vercel token:', '')
        if (!tok?.trim()) { addMessage('System', 'Token kosong.'); set({ isRunning: false }); return }
        get().setConfig({ vercelToken: tok.trim() })
      }
      try {
        let files = get().artifacts.filter((a) => a.action !== 'delete').map((a) => ({ path: a.filename, content: a.content }))
        if (!files.length) {
          addMessage('System', 'Ambil file dari GitHub...')
          const paths = (await listRepoFiles(cfgNow, 80)).filter(
            (p) => (/\.(html?|css|js|json|svg|png|md)$/i.test(p) || p.startsWith('api/')) && !isJunkPath(p)
          )
          for (const path of paths.slice(0, 40)) {
            try {
              const f = await getFile(cfgNow, path)
              if (f) files.push({ path: f.path, content: f.content })
            } catch { /* */ }
          }
        }
        addMessage('System', `🚀 Deploy ${files.length} file...`)
        const dep = await deployToVercel({ token: get().config.vercelToken, name: github.repo || 'vo-app', files })
        addMessage('System', `✅ ${dep.url}`)
      } catch (e: unknown) {
        addMessage('System', 'Vercel: ' + (e instanceof Error ? e.message : String(e)))
      } finally { set({ isRunning: false }) }
      return
    }

    if (detectBulkDeleteAll(userTask)) {
      try {
        const files = await listRepoFiles(cfgNow, 500)
        if (!files.length) { addMessage('System', 'Repo kosong.'); set({ isRunning: false }); return }
        await emptyRepoBranch(cfgNow, `hapus ${files.length}`)
        addMessage('System', `Terhapus ${files.length}.`)
      } catch (e: unknown) { addMessage('System', String(e)) }
      finally { set({ isRunning: false }) }
      return
    }

    try { await get().loadContext() } catch { /* */ }

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) addArtifacts(artifacts.map((a) => ({ filename: a.filename, language: a.language, content: a.content, agentId, action: a.action })))
    }

    try {
      const power = get().powerMode
      const pace = power ? 9000 : 12000
      const tok = power ? 1800 : 1000
      const ctx = get().projectContext
      const richContext = ctx ? `\n\n## REPO\n${ctx.slice(0, power ? 6000 : 2500)}` : `\n\n## REPO: ${github.repoFullName}`
      const mem = memoryBlock(get().agentMemory)

      updateAgent('manager', { status: 'thinking', currentTask: 'Berpikir...' })
      addMessage('System', '🧠 Berpikir dulu...')

      const thinkSystem = `Kamu Budi, PM. Bahasa Indonesia. Wajib ikuti MEMORI.\nFormat singkat:\n## Pemahaman\n## Jenis tugas\n## Keputusan (LANJUT)\n${mem}`

      let thought = ''
      try {
        const th = await callLLMMulti(config, thinkSystem, `Tugas:\n${userTask}${richContext}`, 600)
        thought = th.text
      } catch {
        try { thought = await callLLM(config, thinkSystem, userTask + richContext, 500) }
        catch { thought = '## Pemahaman\n' + userTask.slice(0, 120) + '\n## Keputusan\nLANJUT' }
      }
      addMessage('Budi (Manager)', '🧠 ' + thought.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 320))
      await paceBetweenAgents(Math.min(pace, 5000))

      updateAgent('manager', { status: 'thinking', currentTask: 'Rencana...' })
      const planSystem = `Kamu Budi. Max 5 baris. ## Rencana ## File\n${mem}`
      let plan: string
      try {
        const one = await callLLMMulti(config, planSystem, `Tugas: ${userTask}\n${thought.slice(0, 800)}${richContext}`, 500)
        plan = one.text
      } catch { plan = await callLLM(config, planSystem, userTask + richContext, 400) }
      addMessage('Budi (Manager)', plan.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 280))
      await paceBetweenAgents(pace)

      const workers = [
        { id: 'coder', name: 'Andi', system: 'Kamu Andi. Output HANYA code fence file (```html:index.html). JANGAN penjelasan panjang.' },
        { id: 'writer', name: 'Rina', system: 'Kamu Rina. Output HANYA ```md:README.md singkat.' },
      ]

      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) await paceBetweenAgents(pace)
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const out = await callLLMMulti(
            config,
            w.system + mem,
            `Tugas: ${userTask.slice(0, 1200)}\nPemikiran: ${thought.slice(0, 600)}\nRencana: ${plan.slice(0, 1000)}${richContext}`,
            tok
          )
          const before = get().artifacts.length
          collectFrom(w.id, out.text)
          const made = get().artifacts.slice(before)
          const names = made.map((a) => a.filename).filter(Boolean)
          if (names.length) {
            addMessage(w.name, `✅ Siap: ${names.join(', ')}`)
          } else {
            const brief = out.text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
            addMessage(w.name, brief ? `Catatan: ${brief}` : 'Selesai.')
          }
          updateAgent(w.id, { status: 'done', currentTask: 'Selesai', lastMessage: names[0] || 'ok' })
        } catch (e: unknown) {
          addMessage(w.name, 'Error: ' + (e instanceof Error ? e.message : String(e)))
        }
      }

      if (github.autoPush && get().artifacts.length > 0) {
        try { await get().pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', String(e)) }
      }

      const arts = get().artifacts.filter((a) => a.action !== 'delete')
      if (config.vercelToken && arts.some((a) => /\.html$/i.test(a.filename))) {
        try {
          const dep = await deployToVercel({ token: config.vercelToken, name: github.repo || 'vo-app', files: arts.map((a) => ({ path: a.filename, content: a.content })) })
          addMessage('System', `✅ Online: ${dep.url}`)
        } catch (ve: unknown) { addMessage('System', 'Vercel: ' + (ve instanceof Error ? ve.message : String(ve))) }
      }

      addMessage('Budi (Manager)', `Selesai. File: ${arts.map((a) => a.filename).join(', ') || '-'}`)
    } catch (e: unknown) {
      addMessage('System', 'Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 3000)
    }
  },

  pushArtifactsToGithub: async () => {
    const { github, artifacts, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) throw new Error('Repo belum dipilih')
    if (!artifacts.length) throw new Error('Tidak ada file')
    set({ isPushing: true })
    try {
      const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
      const { ok, errors, deleted } = await pushMany(cfg, artifacts.map((a) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content, action: a.action || 'upsert' })), 'VO AI')
      if (ok.length) addMessage('System', 'Update: ' + ok.join(', '))
      if (deleted?.length) addMessage('System', 'Hapus: ' + deleted.join(', '))
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally { set({ isPushing: false }) }
  },
}))
