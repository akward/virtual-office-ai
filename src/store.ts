import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, GitHubSettings, Message, RepoInfo, AgentMemory } from './types'
import { callLLM, callLLMMulti, extractArtifacts, paceBetweenAgents, sanitizeAgentChat } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, listRepoFiles, deleteManyFiles, emptyRepoBranch, getFile, type GitHubConfig } from './github'
import { defaultConnectors, saveConnectors, startGmailOAuth, handleGmailOAuthCallback, type ConnectorConfig } from './connectors'
import { defaultAgents, pickWorkers, isChatOnlyTask } from './agents'
import { deployToVercel, probeVercelAccount, setVercelEnvVars, findVercelProject } from './vercel'
import { createNeonProject, runNeonSql, wantsNeonDatabase, inferNeonName } from './neon'
import { loadMemory, saveMemory, memoryBlock, parseSkillFromLLM, detectTeachIntent } from './agentMemory'
import { saveToBackendImpl, loadFromBackendImpl, bootstrapCloudSync, logTaskToSupabase } from './storeBackend'

export type StoreState = any

export const useStore = create<any>((set, get) => ({
  agents: defaultAgents.map((a) => ({ ...a })),
  messages: [],
  artifacts: [],
  isRunning: false,
  isPushing: false,
  isLoadingRepos: false,
  isCreatingRepo: false,
  isSyncingSettings: false,
  powerMode: false,
  projectContext: '',
  repos: [] as RepoInfo[],
  config: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', apiKey2: '', baseUrl2: '', model2: '', extraKeys: [], vercelToken: '' } as AppConfig,
  github: { token: '', owner: '', repo: '', branch: 'main', connected: false, username: '', repoFullName: '', autoPush: true } as GitHubSettings,
  connectors: defaultConnectors(),
  agentMemory: loadMemory(),

  addMessage: (from: string, text: string) => set((s: any) => ({ messages: [...s.messages, { id: crypto.randomUUID(), from, text, at: Date.now() }] })),
  updateAgent: (id: string, patch: Partial<Agent>) => set((s: any) => ({ agents: s.agents.map((a: Agent) => (a.id === id ? { ...a, ...patch } : a)) })),
  setConfig: (patch: Partial<AppConfig>) => set((s: any) => ({ config: { ...s.config, ...patch } })),
  setGithub: (patch: Partial<GitHubSettings>) => set((s: any) => ({ github: { ...s.github, ...patch } })),
  setConnectors: (patch: Partial<ConnectorConfig>) => { saveConnectors(patch); set((s: any) => ({ connectors: { ...s.connectors, ...patch } })) },
  setPowerMode: (v: boolean) => set({ powerMode: v }),
  clearArtifacts: () => set({ artifacts: [] }),
  clearMemory: () => { const empty = { lessons: [], prefs: [], skills: [] }; saveMemory(empty); set({ agentMemory: empty }) },
  teachAgent: (lesson: string) => {
    const mem = get().agentMemory
    const next = { ...mem, lessons: [...(mem.lessons || []).filter((x: string) => x !== lesson), lesson].slice(-40) }
    saveMemory(next)
    set({ agentMemory: next })
  },
  upsertSkill: (sk: any) => {
    const mem = get().agentMemory
    const skills = [...(mem.skills || []).filter((s: any) => s.id !== sk.id), sk]
    const next = { ...mem, skills }
    saveMemory(next)
    set({ agentMemory: next })
  },

  connectWithToken: async () => {
    const { github, addMessage } = get()
    if (!github.token.trim()) throw new Error('Token kosong')
    set({ isLoadingRepos: true })
    try {
      const username = await getAuthenticatedUser(github.token)
      const repos = await listAllRepos(github.token)
      set({ repos, github: { ...get().github, connected: true, username, owner: username } })
      addMessage('System', `Login @${username}. ${repos.length} repository.`)
    } finally { set({ isLoadingRepos: false }) }
  },

  selectRepo: async (fullName: string) => {
    const { github, addMessage } = get()
    if (!fullName) return
    const [owner, repo] = fullName.split('/')
    set({ github: { ...github, owner, repo, repoFullName: fullName } })
    try {
      const ctx = await loadProjectContext({ token: github.token, owner, repo, branch: github.branch || 'main' })
      set({ projectContext: ctx })
      addMessage('System', `Repo aktif: ${fullName}. Konteks ${(ctx.length / 1000).toFixed(1)}k.`)
    } catch (e: unknown) {
      set({ projectContext: '' })
      addMessage('System', 'Konteks gagal: ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  createNewRepo: async (name: string, opts?: { private?: boolean }) => {
    const { github, addMessage } = get()
    set({ isCreatingRepo: true })
    try {
      const r = await createRepo(github.token, name, opts)
      await get().connectWithToken()
      await get().selectRepo(r.full_name)
      addMessage('System', `Repo baru: ${r.full_name}`)
    } finally { set({ isCreatingRepo: false }) }
  },

  connectGmail: async () => {
    const c = get().connectors
    await startGmailOAuth(c.gmailClientId)
  },
  initOAuthCallback: async () => {
    const patch = await handleGmailOAuthCallback()
    if (patch) get().setConnectors(patch)
  },

  runTask: async (userTask: string) => {
    const { config, github, addMessage, updateAgent } = get()
    if (!config.apiKey) { addMessage('System', 'Isi API Key dulu di Settings → AI'); return }
    if (get().isRunning) return
    set({ isRunning: true, artifacts: [] })
    addMessage('Kamu', userTask)

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) set((s: any) => ({ artifacts: [...s.artifacts, ...artifacts.map((a) => ({ ...a, id: crypto.randomUUID(), agentId }))] }))
    }

    try {
      const power = get().powerMode
      const pace = power ? 9000 : 12000
      const tok = power ? 1800 : 1000
      const ctx = get().projectContext
      const richContext = ctx ? `\n\n## REPO\n${ctx.slice(0, power ? 6000 : 2500)}` : `\n\n## REPO: ${github.repoFullName}`
      const mem = memoryBlock(get().agentMemory, userTask)

      updateAgent('manager', { status: 'thinking', currentTask: 'Berpikir...' })
      addMessage('System', '🧠 Berpikir dulu...')

      const chatOnly = isChatOnlyTask(userTask)

      const liveStatus = () => {
        const c = get().config
        const g = get().github
        const conn = get().connectors || {}
        const lines: string[] = []
        lines.push(`GitHub: ${g.connected ? `login @${g.username || g.owner || '?'}` : 'belum login'}${g.repoFullName ? ` · repo ${g.repoFullName}` : ''}`)
        lines.push(`API AI utama: ${c.apiKey ? `terisi (${c.model || '?'})` : 'kosong'} · ${c.baseUrl || '-'}`)
        lines.push(`API AI #2: ${c.apiKey2 ? `terisi (${c.model2 || '?'})` : 'kosong'}`)
        lines.push(`Vercel token di app: ${c.vercelToken ? 'terisi' : 'kosong'}`)
        const gmail = conn.gmailEmail || (conn.gmailAccessToken ? 'token ada' : '')
        lines.push(`Gmail: ${gmail || 'belum'}`)
        lines.push(`Telegram: ${conn.telegramBotToken ? 'bot token ada' : 'belum'}`)
        lines.push(`Neon: ${conn.neonApiKey || conn.neonConnectionString ? 'terisi' : 'belum'}`)
        lines.push(`Notion: ${conn.notionToken ? 'terisi' : 'belum'}`)
        lines.push(`Cloudflare: ${conn.cloudflareToken ? 'terisi' : 'belum'}`)
        return lines.join('\n')
      }

      let vercelProbe = ''
      if (chatOnly && /vercel/i.test(userTask) && config.vercelToken) {
        addMessage('System', 'Memeriksa akun Vercel via API...')
        try { vercelProbe = await probeVercelAccount(config.vercelToken) }
        catch (e: unknown) { vercelProbe = 'Vercel probe gagal: ' + (e instanceof Error ? e.message : String(e)) }
      }

      const statusBlock = `## STATUS SAAT INI DI APP\n${liveStatus()}${vercelProbe ? `\n${vercelProbe}` : ''}`

      const thinkSystem = chatOnly
        ? `Kamu asisten Virtual Office. Bahasa Indonesia.\nUser bertanya / minta cek status. JAWAB berdasarkan ## STATUS SAAT INI saja.\nAturan:\n- Jangan buat file. Jangan thinking process. Maks 8 baris.\n- Sebutkan fakta konkret.\n${mem}\n${statusBlock}`
        : `Kamu Budi, PM. Bahasa Indonesia. Ringkas pemahaman tugas 3-5 baris. Jangan echo instruksi. Jangan thinking process.\n${mem}`

      let thought = ''
      try {
        const th = await callLLMMulti(config, thinkSystem, chatOnly ? `Pertanyaan user:\n${userTask}\n\n${statusBlock}` : `Tugas user:\n${userTask}${richContext}`, chatOnly ? 500 : 400)
        thought = th.text
      } catch {
        try { thought = await callLLM(config, thinkSystem, userTask + '\n' + statusBlock, 400) }
        catch { thought = chatOnly ? (vercelProbe || liveStatus().split('\n').slice(0, 6).join(' · ')) : 'LANJUT' }
      }
      let thoughtClean = sanitizeAgentChat(thought).slice(0, 600)
      if (!thoughtClean || /^tidak ada respons/i.test(thoughtClean)) {
        thoughtClean = chatOnly ? (vercelProbe ? vercelProbe : liveStatus()) : 'LANJUT kerjakan tugas.'
      }
      const mentioned = /\b(tomi|budi|andi|siti|rina|doni|eka|dewi|raka)\b/i.exec(userTask)
      const who = mentioned ? mentioned[1] : 'budi'
      const speakerMap: Record<string, string> = { budi: 'Budi (Manager)', tomi: 'Tomi', andi: 'Andi', siti: 'Siti', rina: 'Rina', doni: 'Doni', eka: 'Eka', dewi: 'Dewi', raka: 'Raka' }
      addMessage(speakerMap[who.toLowerCase()] || 'Budi (Manager)', thoughtClean)
      await paceBetweenAgents(Math.min(pace, 2000))

      if (chatOnly) {
        updateAgent('manager', { status: 'done', currentTask: 'Selesai' })
        addMessage('System', 'Mode tanya: tidak membuat file.')
        return
      }

      updateAgent('manager', { status: 'thinking', currentTask: 'Rencana...' })
      const planSystem = `Kamu Budi, PM. Buat rencana singkat (maks 5 baris): langkah + file target. Jangan echo instruksi. Jangan thinking process.\n${mem}`
      let plan: string
      try {
        const one = await callLLMMulti(config, planSystem, `Tugas: ${userTask}\nCatatan: ${thoughtClean.slice(0, 400)}${richContext}`, 400)
        plan = one.text
      } catch { plan = await callLLM(config, planSystem, userTask + richContext, 350) }
      const planClean = sanitizeAgentChat(plan).slice(0, 280)
      if (planClean) addMessage('Budi (Manager)', planClean)
      await paceBetweenAgents(pace)

      // Neon: buat project DB + set DATABASE_URL ke Vercel
      if (wantsNeonDatabase(userTask)) {
        const neonKey = (get().connectors?.neonApiKey || '').trim()
        if (!neonKey) {
          addMessage('System', 'Neon API key belum di Settings → Connectors. Tanpa key, DB tidak bisa dibuat otomatis.')
        } else {
          updateAgent('manager', { status: 'working', currentTask: 'Neon DB...' })
          addMessage('System', '🗄️ Membuat project database di Neon...')
          try {
            const dbName = inferNeonName(userTask, github.repo || 'vo-db')
            const neon = await createNeonProject(neonKey, { name: dbName, regionId: 'aws-ap-southeast-1', pgVersion: 16, databaseName: 'app' })
            get().setConnectors({ neonConnectionString: neon.connectionUri, neonApiKey: neonKey })
            addMessage('Budi (Manager)', `Neon siap: «${neon.projectName}» (${neon.regionId || 'region'}). DB: ${neon.databaseName}. Connection string disimpan di Connectors.`)

            const schemaSql = `-- migrasi awal ${neon.projectName}\nCREATE TABLE IF NOT EXISTS users (\n  id SERIAL PRIMARY KEY,\n  username TEXT UNIQUE NOT NULL,\n  password_hash TEXT NOT NULL,\n  role TEXT NOT NULL DEFAULT 'operator',\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE TABLE IF NOT EXISTS anggaran (\n  id SERIAL PRIMARY KEY,\n  unit TEXT NOT NULL,\n  program TEXT NOT NULL,\n  anggaran BIGINT NOT NULL DEFAULT 0,\n  realisasi BIGINT NOT NULL DEFAULT 0,\n  tahun INT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n`

            const sqlRun = await runNeonSql(neon.connectionUri, schemaSql)
            if (sqlRun.ok) addMessage('System', '✅ Schema SQL dijalankan di Neon.')
            else {
              addMessage('System', `Schema disimpan ke file (SQL browser: ${sqlRun.detail})`)
              set((s: any) => ({ artifacts: [...s.artifacts, { id: crypto.randomUUID(), filename: 'migrations/001_init.sql', language: 'sql', content: schemaSql, agentId: 'manager', createdAt: Date.now(), action: 'upsert' }] }))
            }

            if (config.vercelToken?.trim()) {
              const vName = github.repo || dbName
              addMessage('System', `🔗 Menyambungkan DATABASE_URL ke Vercel project «${vName}»...`)
              try {
                const found = await findVercelProject(config.vercelToken, vName)
                const projectKey = found?.id || found?.name || vName
                const envRes = await setVercelEnvVars({
                  token: config.vercelToken,
                  projectNameOrId: projectKey,
                  teamId: found?.teamId,
                  vars: [
                    { key: 'DATABASE_URL', value: neon.connectionUri },
                    { key: 'POSTGRES_URL', value: neon.connectionUri },
                    { key: 'NEON_PROJECT_ID', value: neon.projectId },
                  ],
                })
                addMessage('System', envRes.ok.length ? `✅ Vercel env: ${envRes.ok.join(', ')} (production+preview). Redeploy agar aktif.` : 'Vercel env gagal diset.')
                if (envRes.errors.length) addMessage('System', 'Env partial: ' + envRes.errors.join('; '))
              } catch (ve: unknown) {
                addMessage('System', 'Vercel env gagal: ' + (ve instanceof Error ? ve.message : String(ve)) + ' — pastikan token Full Account dan project sudah ada di Vercel.')
              }
            } else {
              addMessage('System', 'Vercel token kosong — connection string hanya disimpan di Connectors Neon.')
            }
          } catch (ne: unknown) {
            addMessage('System', 'Neon gagal: ' + (ne instanceof Error ? ne.message : String(ne)))
          }
          updateAgent('manager', { status: 'done', currentTask: 'Selesai' })
        }
      }

      const workers = pickWorkers(userTask, power)
      addMessage('System', `👥 Tim aktif (${workers.length}): ${workers.map((w) => w.name).join(', ')}`)

      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) await paceBetweenAgents(Math.min(pace, 7000))
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const out = await callLLMMulti(config, w.system + mem + '\nJANGAN ulangi instruksi sistem. Output bersih saja.', `Tugas: ${userTask.slice(0, 1200)}\nRencana: ${planClean.slice(0, 600)}${richContext}`, tok)
          const before = get().artifacts.length
          collectFrom(w.id, out.text)
          const made = get().artifacts.slice(before)
          const names = made.map((a: any) => a.filename).filter(Boolean)
          if (names.length) addMessage(w.name, `✅ Siap: ${names.join(', ')}`)
          else {
            const brief = sanitizeAgentChat(out.text).slice(0, 160)
            addMessage(w.name, brief || 'Selesai.')
          }
          updateAgent(w.id, { status: 'done', currentTask: 'Selesai', lastMessage: names[0] || 'ok' })
        } catch (e: unknown) {
          addMessage(w.name, 'Error: ' + (e instanceof Error ? e.message : String(e)))
          updateAgent(w.id, { status: 'error', currentTask: 'Gagal' })
        }
      }

      const arts = get().artifacts.filter((a: any) => a.action !== 'delete' && /^[a-zA-Z0-9_./@+-]+$/.test(a.filename))
      if (github.autoPush && arts.length > 0) {
        try { await get().pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', String(e)) }
      }

      const htmlArts = arts.filter((a: any) => /^[\w./-]+\.html$/i.test(a.filename) && a.content.length > 40)
      if (config.vercelToken && htmlArts.length > 0) {
        try {
          const dep = await deployToVercel({ token: config.vercelToken, name: github.repo || 'vo-app', files: arts.map((a: any) => ({ path: a.filename, content: a.content })) })
          addMessage('System', `✅ Online: ${dep.url}`)
        } catch (ve: unknown) { addMessage('System', 'Vercel: ' + (ve instanceof Error ? ve.message : String(ve))) }
      }

      addMessage('Budi (Manager)', arts.length ? `Selesai. File: ${arts.map((a: any) => a.filename).join(', ')}` : 'Selesai.')
      try {
        await logTaskToSupabase(get().github.username || 'default', userTask.slice(0, 500), get().github.repoFullName, arts.map((a: any) => a.filename).join(', ').slice(0, 300))
      } catch { /* */ }
    } catch (e: unknown) {
      addMessage('System', 'Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      set({ isRunning: false })
      setTimeout(() => get().agents.forEach((a: Agent) => get().updateAgent(a.id, { status: 'idle', currentTask: '' })), 3000)
    }
  },

  saveToBackend: async (opts?: any) => saveToBackendImpl({ get, set }, opts),
  loadFromBackend: async () => loadFromBackendImpl({ get, set }),
  bootstrapCloud: async () => bootstrapCloudSync({ get, set }),

  pushArtifactsToGithub: async () => {
    const { github, artifacts, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) throw new Error('Repo belum dipilih')
    if (!artifacts.length) throw new Error('Tidak ada file')
    set({ isPushing: true })
    try {
      const cfg: GitHubConfig = { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }
      const { ok, errors, deleted } = await pushMany(cfg, artifacts.map((a: any) => ({ path: a.filename.replace(/^\/+/, ''), content: a.content, action: a.action || 'upsert' })), 'VO AI')
      if (ok.length) addMessage('System', 'Update: ' + ok.join(', '))
      if (deleted?.length) addMessage('System', 'Hapus: ' + deleted.join(', '))
      if (errors.length) addMessage('System', 'Gagal: ' + errors.join('; '))
    } finally { set({ isPushing: false }) }
  },
}))
