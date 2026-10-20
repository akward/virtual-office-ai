import { create } from 'zustand'
import type { Agent, AppConfig, GitHubSettings, AgentMemory } from './types'
import { callLLM, callLLMMulti, extractArtifacts, paceBetweenAgents, sanitizeAgentChat, describeFallbackChain } from './llm'
import { getAuthenticatedUser, listAllRepos, loadProjectContext, pushMany, createRepo, type GitHubConfig } from './github'
import { defaultConnectors, saveConnectors, startGmailOAuth, handleGmailOAuthCallback, type ConnectorConfig } from './connectors'
import { defaultAgents, pickWorkers, isChatOnlyTask, getVerifierWorker, parseVerifierVerdict } from './agents'
import { classifyTaskIntentWithLLM, isChatOnlyIntent, type TaskIntent } from './taskIntent'
import {
  parsePlanReply,
  wantsSkipConfirm,
  formatPlanPrompt,
  runCompletionChecklist,
  formatResultSummary,
  type PendingPlan,
} from './taskLifecycle'
import {
  formatStep,
  formatGitDiff,
  decideTaskStatus,
  buildTaskSummary,
} from './observability'
import { deployToVercel, probeVercelAccount, setVercelEnvVars, findVercelProject } from './vercel'
import { createNeonProject, runNeonSql, wantsNeonDatabase, inferNeonName, listNeonTables, listNeonProjects, wantsNeonProbe, wantsNeonConnectionString, fetchNeonConnectionUri } from './neon'
import { wantsRepoCleanup, cleanRepoJunk } from './repoCleanup'
import { wantsFullAuto, filterProductionArtifacts, autoCleanAfterPush, autoDeployIfNeeded } from './autoPipeline'
import { openPreviewBrowser, verifyLiveUrl, formatVerifyReport } from './verifyDeploy'
import { loadMemory, saveMemory, memoryBlock } from './agentMemory'
import { saveToBackendImpl, loadFromBackendImpl, bootstrapCloudSync, logTaskToSupabase, fetchTaskHistory } from './storeBackend'

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
  repos: [] as any[],
  config: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', apiKey2: '', baseUrl2: '', model2: '', extraKeys: [], vercelToken: '' } as AppConfig,
  github: { token: '', owner: '', repo: '', branch: 'main', connected: false, username: '', repoFullName: '', autoPush: true } as GitHubSettings,
  connectors: defaultConnectors(),
  agentMemory: loadMemory(),
  pendingPlan: null as PendingPlan | null,
  taskHistory: [] as { id?: string; task: string; status?: string; repo?: string; created_at?: string; result_summary?: string }[],

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
    saveMemory(next); set({ agentMemory: next })
  },
  upsertSkill: (sk: any) => {
    const mem = get().agentMemory
    const skills = [...(mem.skills || []).filter((s: any) => s.id !== sk.id), sk]
    const next = { ...mem, skills }; saveMemory(next); set({ agentMemory: next })
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

  connectGmail: async () => { await startGmailOAuth(get().connectors.gmailClientId) },
  initOAuthCallback: async () => {
    const patch = await handleGmailOAuthCallback()
    if (patch) get().setConnectors(patch)
  },

  loadTaskHistory: async () => {
    try {
      const user = get().github?.username || 'akward'
      const rows = await fetchTaskHistory(user, 12)
      set({ taskHistory: rows })
      return rows
    } catch {
      return []
    }
  },

  confirmPlan: async () => {
    const p = get().pendingPlan
    if (!p || get().isRunning) return
    set({ pendingPlan: null })
    await get()._executeApprovedTask(p)
  },

  cancelPlan: () => {
    if (!get().pendingPlan) return
    set({ pendingPlan: null })
    get().addMessage('System', 'Rencana dibatalkan.')
    get().updateAgent('manager', { status: 'idle', currentTask: '' })
  },

  runTask: async (userTask: string) => {
    const { config, github, addMessage, updateAgent } = get()
    if (get().isRunning) return

    // —— Konfirmasi / batal / revisi rencana tertunda ——
    const pending = get().pendingPlan
    if (pending) {
      const reply = parsePlanReply(userTask)
      addMessage('Kamu', userTask)
      if (reply.kind === 'cancel') {
        set({ pendingPlan: null })
        addMessage('System', 'Rencana dibatalkan.')
        updateAgent('manager', { status: 'idle', currentTask: '' })
        return
      }
      if (reply.kind === 'confirm') {
        set({ pendingPlan: null })
        await get()._executeApprovedTask(pending)
        return
      }
      if (reply.kind === 'revise') {
        set({ isRunning: true })
        try {
          updateAgent('manager', { status: 'thinking', currentTask: 'Revisi rencana...' })
          const one = await callLLMMulti(
            config,
            `Kamu Budi, PM. Revisi rencana maks 5 baris (langkah + file) sesuai catatan user. ${pending.mem}`,
            `Tugas asli:\n${pending.task.slice(0, 1500)}\nRencana lama:\n${pending.plan}\nCatatan revisi:\n${reply.note}${pending.richContext}`,
            400
          )
          const planClean = sanitizeAgentChat(one.text).slice(0, 400) || pending.plan
          const next: PendingPlan = { ...pending, plan: planClean, thought: planClean }
          set({ pendingPlan: next, isRunning: false })
          addMessage('Budi (Manager)', formatPlanPrompt(planClean, pending.intent))
          addMessage('System', '⏸️ Menunggu konfirmasi (lanjut / ubah / batal).')
          updateAgent('manager', { status: 'idle', currentTask: 'Menunggu konfirmasi' })
        } catch (e: unknown) {
          addMessage('System', 'Revisi gagal: ' + (e instanceof Error ? e.message : String(e)))
          set({ isRunning: false })
        }
        return
      }
      addMessage('System', 'Masih ada rencana tertunda. Ketik **lanjut**, **ubah: …**, atau **batal**.')
      return
    }

    set({ isRunning: true, artifacts: [] })

    if (wantsNeonConnectionString(userTask)) {
      addMessage('Kamu', userTask)
      const key = (get().connectors?.neonApiKey || '').trim()
      if (!key) { addMessage('System', 'Isi Neon API key dulu di Connectors → Neon.'); set({ isRunning: false }); return }
      const name = inferNeonName(userTask, 'neon')
      addMessage('System', `Mengambil connection string Neon untuk «${name}»...`)
      try {
        const got = await fetchNeonConnectionUri(key, { projectName: name })
        get().setConnectors({ neonConnectionString: got.connectionUri, neonApiKey: key })
        try { await get().saveToBackend({ includeGithubToken: true }) } catch { /* */ }
        addMessage('Budi (Manager)', `Connection string tersimpan untuk «${got.projectName || name}».`)
      } catch (e: unknown) {
        addMessage('System', 'Gagal: ' + (e instanceof Error ? e.message : String(e)))
      }
      set({ isRunning: false }); return
    }

    if (!config.apiKey) { addMessage('System', 'Isi API Key dulu di Settings → AI'); set({ isRunning: false }); return }

    addMessage('Kamu', userTask)
    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) set((s: any) => ({ artifacts: [...s.artifacts, ...artifacts.map((a) => ({ ...a, id: crypto.randomUUID(), agentId }))] }))
    }

    try {
      const power = get().powerMode
      const pace = power ? 3500 : 6000
      const tok = power ? 2000 : 1200
      const ctx = get().projectContext
      const richContext = ctx ? `\n\n## REPO\n${ctx.slice(0, power ? 6000 : 2500)}` : `\n\n## REPO: ${github.repoFullName}`
      const mem = memoryBlock(get().agentMemory, userTask)

      updateAgent('manager', { status: 'thinking', currentTask: 'Berpikir...' })
      addMessage('System', formatStep('intent', 'Pahami niat perintah'))

      let intent: TaskIntent = 'ask'
      try { intent = await classifyTaskIntentWithLLM(config, userTask) }
      catch { intent = isChatOnlyTask(userTask) ? 'ask' : 'build' }
      const chatOnly = isChatOnlyIntent(intent)
      addMessage('System', formatStep('intent', `Niat = ${intent}`, chatOnly ? 'mode tanya (tanpa file)' : 'mode kerja'))

      const liveStatus = () => {
        const c = get().config; const g = get().github; const conn = get().connectors || {}
        return [
          `GitHub: ${g.connected ? '@' + (g.username || g.owner) : 'belum'}${g.repoFullName ? ' · ' + g.repoFullName : ''}`,
          `API: ${c.apiKey ? c.model : 'kosong'}`,
          `Vercel: ${c.vercelToken ? 'ada' : 'belum'}`,
          `Neon: ${conn.neonApiKey || conn.neonConnectionString ? 'ada' : 'belum'}`,
        ].join('\n')
      }

      let vercelProbe = '', neonProbe = ''
      if (chatOnly && /vercel/i.test(userTask) && config.vercelToken) {
        try { vercelProbe = await probeVercelAccount(config.vercelToken) } catch (e: unknown) { vercelProbe = String(e) }
      }
      if ((chatOnly || wantsNeonProbe(userTask)) && wantsNeonProbe(userTask)) {
        const conn = get().connectors || {}
        try {
          if (conn.neonConnectionString) neonProbe = await listNeonTables(conn.neonConnectionString)
          else if (conn.neonApiKey) {
            const projs = await listNeonProjects(conn.neonApiKey)
            neonProbe = projs.length ? 'Project: ' + projs.map((p) => p.name).join(', ') : 'Tidak ada project Neon'
          } else neonProbe = 'Neon belum di Connectors'
        } catch (e: unknown) { neonProbe = String(e) }
      }

      const statusBlock = `## STATUS\n${liveStatus()}\n${vercelProbe}\n${neonProbe}`
      const thinkSystem = chatOnly
        ? `Asisten Virtual Office. Bahasa Indonesia. Jawab seperti Grok: akurat dari STATUS. Jangan tebak URL fiktif. Jangan buat file. Maks 8 baris.\n${mem}\n${statusBlock}`
        : `Kamu Budi, PM. Pahami perintah seperti ChatGPT/Grok. (1) Satu kalimat hasil akhir yang user ingin. (2) 2-4 langkah konkret. Jangan ganti topik. Dashboard anggaran multi-user = login+role+chart, BUKAN Deploy Status Checker. Jangan thinking process.\n${mem}`

      let thought = ''
      try {
        const th = await callLLMMulti(config, thinkSystem, chatOnly ? `Pertanyaan:\n${userTask}\n${statusBlock}` : `Tugas:\n${userTask}${richContext}`, chatOnly ? 500 : 400)
        thought = th.text
      } catch {
        try { thought = await callLLM(config, thinkSystem, userTask + '\n' + statusBlock, 400) }
        catch { thought = chatOnly ? (neonProbe || vercelProbe || liveStatus()) : 'LANJUT' }
      }
      let thoughtClean = sanitizeAgentChat(thought).slice(0, 600)
      if (!thoughtClean) thoughtClean = chatOnly ? liveStatus() : 'LANJUT kerjakan tugas.'
      addMessage('Budi (Manager)', thoughtClean)
      await paceBetweenAgents(Math.min(pace, 2000))

      if (chatOnly) {
        updateAgent('manager', { status: 'done', currentTask: 'Selesai' })
        addMessage('System', 'Mode tanya: tidak membuat file.')
        try {
          await logTaskToSupabase(
            get().github?.username || 'akward',
            userTask,
            get().github?.repoFullName,
            buildTaskSummary({ status: 'ask', intent }),
            'ask'
          )
        } catch { /* */ }
        set({ isRunning: false })
        return
      }

      if (wantsRepoCleanup(userTask)) {
        if (!github.token || !github.owner || !github.repo) {
          addMessage('System', 'Pilih repo GitHub dulu.'); updateAgent('manager', { status: 'done', currentTask: 'Selesai' }); set({ isRunning: false }); return
        }
        addMessage('System', 'Membersihkan sampah...')
        try {
          const result = await cleanRepoJunk({ token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' })
          addMessage('Budi (Manager)', `Bersih: terhapus ${result.deleted.length} / target ${result.total}.`)
        } catch (e: unknown) { addMessage('System', String(e)) }
        updateAgent('manager', { status: 'done', currentTask: 'Selesai' }); set({ isRunning: false }); return
      }

      updateAgent('manager', { status: 'thinking', currentTask: 'Rencana...' })
      addMessage('System', formatStep('plan', 'Menyusun rencana singkat'))
      let plan = ''
      try {
        const one = await callLLMMulti(config, `Kamu Budi, PM. Rencana maks 5 baris mengejar HASIL AKHIR user (langkah + nama file). ${mem}`, `Perintah user:\n${userTask.slice(0, 1500)}\nPemahaman:\n${thoughtClean.slice(0, 400)}${richContext}`, 400)
        plan = one.text
      } catch { plan = await callLLM(config, 'Rencana singkat.', userTask + richContext, 350) }
      const planClean = sanitizeAgentChat(plan).slice(0, 400) || '1. Kerjakan perintah user\n2. Tulis file produksi\n3. Push & deploy bila perlu'
      addMessage('Budi (Manager)', planClean)

      if (!wantsSkipConfirm(userTask, power)) {
        const pendingPlan: PendingPlan = {
          task: userTask,
          plan: planClean,
          thought: thoughtClean,
          intent,
          power,
          tok,
          pace,
          richContext,
          mem,
        }
        set({ pendingPlan, isRunning: false })
        addMessage('Budi (Manager)', formatPlanPrompt(planClean, intent))
        addMessage('System', '⏸️ Menunggu konfirmasi sebelum agent bekerja.')
        updateAgent('manager', { status: 'idle', currentTask: 'Menunggu konfirmasi' })
        return
      }

      await get()._executeApprovedTask({
        task: userTask,
        plan: planClean,
        thought: thoughtClean,
        intent,
        power,
        tok,
        pace,
        richContext,
        mem,
      })
    } catch (e: unknown) {
      addMessage('System', 'Error: ' + (e instanceof Error ? e.message : String(e)))
      updateAgent('manager', { status: 'error', currentTask: 'Gagal' })
    } finally {
      if (!get().pendingPlan) {
        set({ isRunning: false })
        get().agents.forEach((a: Agent) => { if (a.status === 'working' || a.status === 'thinking') updateAgent(a.id, { status: 'idle', currentTask: '' }) })
      }
    }
  },

  _executeApprovedTask: async (p: PendingPlan) => {
    const { config, github, addMessage, updateAgent } = get()
    set({ isRunning: true, artifacts: [] })
    const userTask = p.task
    const planClean = p.plan
    const intent = p.intent
    const power = p.power
    const tok = p.tok
    const pace = p.pace
    const richContext = p.richContext
    const mem = p.mem
    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) set((s: any) => ({ artifacts: [...s.artifacts, ...artifacts.map((a: any) => ({ ...a, id: crypto.randomUUID(), agentId }))] }))
    }
    try {
      addMessage('System', formatStep('files', 'Eksekusi disetujui — agent menulis file'))
      try { addMessage('System', 'Model chain: ' + describeFallbackChain(config)) } catch { /* */ }
      updateAgent('manager', { status: 'working', currentTask: 'Eksekusi...' })

      if (wantsNeonDatabase(userTask)) {
        const neonKey = (get().connectors?.neonApiKey || '').trim()
        if (neonKey) {
          addMessage('System', '🗄️ Neon DB...')
          try {
            const dbName = inferNeonName(userTask, github.repo || 'vo-db')
            const neon = await createNeonProject(neonKey, { name: dbName, regionId: 'aws-ap-southeast-1', pgVersion: 16, databaseName: 'app' })
            get().setConnectors({ neonConnectionString: neon.connectionUri, neonApiKey: neonKey })
            addMessage('Budi (Manager)', `Neon siap: ${neon.projectName}`)
            await runNeonSql(neon.connectionUri, `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS anggaran (id SERIAL PRIMARY KEY, unit TEXT NOT NULL, program TEXT NOT NULL, anggaran BIGINT NOT NULL DEFAULT 0, realisasi BIGINT NOT NULL DEFAULT 0, tahun INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`)
            if (config.vercelToken?.trim()) {
              try {
                const found = await findVercelProject(config.vercelToken, github.repo || dbName)
                await setVercelEnvVars({ token: config.vercelToken, projectNameOrId: found?.id || found?.name || dbName, teamId: found?.teamId, vars: [{ key: 'DATABASE_URL', value: neon.connectionUri }, { key: 'POSTGRES_URL', value: neon.connectionUri }] })
              } catch { /* */ }
            }
          } catch (ne: unknown) { addMessage('System', 'Neon: ' + (ne instanceof Error ? ne.message : String(ne))) }
        }
      }

      const workers = pickWorkers(userTask, power)
      addMessage('System', formatStep('files', `Tim menulis file (${workers.length})`, workers.map((w) => w.name).join(', ')))

      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi]
        if (wi > 0) await paceBetweenAgents(Math.min(pace, 5000))
        updateAgent(w.id, { status: 'working', currentTask: 'Kerja...' })
        try {
          const out = await callLLMMulti(config, w.system + mem + '\nOutput bersih. Kerjakan PERSIS yang user minta.', `Perintah user:\n${userTask.slice(0, 1500)}\nRencana PM:\n${planClean.slice(0, 600)}${richContext}`, tok)
          const before = get().artifacts.length
          collectFrom(w.id, out.text)
          const names = get().artifacts.slice(before).map((a: any) => a.filename).filter(Boolean)
          addMessage(w.name, names.length ? `✅ ${names.join(', ')}` : (sanitizeAgentChat(out.text).slice(0, 160) || 'Selesai.'))
          updateAgent(w.id, { status: 'done', currentTask: 'Selesai', lastMessage: names[0] || 'ok' })
        } catch (e: unknown) {
          addMessage(w.name, 'Error: ' + (e instanceof Error ? e.message : String(e)))
          updateAgent(w.id, { status: 'error', currentTask: 'Gagal' })
        }
      }

      let arts = filterProductionArtifacts(get().artifacts as any[]).filter((a: any) => a.action !== 'delete' && /^[a-zA-Z0-9_./@+-]+$/.test(a.filename))

      // —— Verifier wajib (Yoga): tolak push jika kriteria user belum terpenuhi ——
      let verifierPass = true
      let verifierReason = ''
      try {
        const vw = getVerifierWorker()
        updateAgent('verifier', { status: 'working', currentTask: 'Verifikasi hasil...' })
        addMessage('System', formatStep('checklist', 'Verifier (Yoga) menilai hasil vs perintah user'))
        const fileNames = arts.map((a: any) => a.filename)
        const samples = arts.slice(0, 4).map((a: any) => `### ${a.filename}\n${String(a.content || '').slice(0, 400)}`).join('\n')
        const vOut = await callLLMMulti(
          config,
          vw.system + mem,
          `Tugas user (kriteria):
${userTask.slice(0, 1800)}

Rencana PM:
${planClean.slice(0, 500)}

File dihasilkan (${fileNames.length}): ${fileNames.join(', ') || '(kosong)'}

Cuplikan:
${samples || '(tidak ada)'}

Putuskan VERDICT: PASS atau VERDICT: FAIL.`,
          500
        )
        const verdict = parseVerifierVerdict(vOut.text)
        verifierPass = verdict.pass
        verifierReason = verdict.reason
        addMessage(
          vw.name,
          verifierPass
            ? `VERDICT: PASS — ${verifierReason.slice(0, 180)}`
            : `VERDICT: FAIL — ${verifierReason.slice(0, 220)}`
        )
        updateAgent('verifier', {
          status: verifierPass ? 'done' : 'error',
          currentTask: verifierPass ? 'Lulus' : 'Gagal',
          lastMessage: verifierPass ? 'PASS' : 'FAIL',
        })
      } catch (ve: unknown) {
        // jangan blokir total jika verifier LLM error — lanjut dengan peringatan
        verifierPass = true
        verifierReason = 'verifier skip: ' + (ve instanceof Error ? ve.message : String(ve))
        addMessage('System', 'Verifier skip: ' + verifierReason.slice(0, 160))
        updateAgent('verifier', { status: 'idle', currentTask: '' })
      }

      if (!verifierPass) {
        addMessage('System', formatStep('error', 'Push/deploy dibatalkan — Verifier menolak hasil', verifierReason.slice(0, 200)))
        addMessage('Budi (Manager)', formatResultSummary({
          intent,
          fileNames: arts.map((a: any) => a.filename),
          checklist: [{ name: 'Verifier', ok: false, detail: verifierReason.slice(0, 160) }],
        }))
        updateAgent('manager', { status: 'error', currentTask: 'Ditolak verifier' })
        try {
          await logTaskToSupabase(
            get().github?.username || 'akward',
            userTask,
            get().github?.repoFullName,
            buildTaskSummary({ status: 'fail', intent, files: arts.map((a: any) => a.filename), error: 'verifier: ' + verifierReason }),
            'fail'
          )
          await get().loadTaskHistory()
        } catch { /* */ }
        return
      }

      let pushOk: string[] = []
      let pushDeleted: string[] = []
      let pushErrors: string[] = []
      if (github.autoPush && arts.length > 0) {
        addMessage('System', formatStep('push', 'Push ke GitHub', `${arts.length} file`))
        try {
          const files = arts.map((a: any) => ({ path: a.filename, content: a.content, action: a.action }))
          const pr = await pushMany(
            { token: github.token!, owner: github.owner!, repo: github.repo!, branch: github.branch || 'main' },
            files,
            'VO AI update'
          )
          pushOk = pr.ok || files.map((f: any) => f.path)
          pushDeleted = pr.deleted || []
          pushErrors = pr.errors || []
          addMessage('System', formatGitDiff({ changed: pushOk, deleted: pushDeleted, errors: pushErrors }))
        } catch (e: unknown) {
          pushErrors = [e instanceof Error ? e.message : String(e)]
          addMessage('System', formatStep('push', 'Push gagal', pushErrors[0]))
        }
      } else if (arts.length) {
        pushOk = arts.map((a: any) => a.filename)
        addMessage('System', formatStep('push', 'Auto-push off — file hanya di panel', pushOk.slice(0, 8).join(', ')))
      }

      let cleanDeleted: string[] = []
      if (github.token && github.owner && github.repo) {
        try {
          const cleaned = await autoCleanAfterPush(
            { token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' },
            addMessage
          )
          cleanDeleted = cleaned.deleted || []
          if (cleanDeleted.length) {
            addMessage('System', formatGitDiff({ changed: pushOk, deleted: cleanDeleted }))
          }
        } catch { /* */ }
      }

      const files = arts.map((a: any) => ({ path: a.filename, content: a.content }))
      const dep = await autoDeployIfNeeded({
        task: userTask,
        vercelToken: config.vercelToken,
        repoName: github.repo || 'vo-app',
        files,
        addMessage,
        openBrowser: true,
        verify: true,
      })

      const names = arts.map((a: any) => a.filename)
      addMessage('System', formatStep('checklist', 'Checklist selesai'))
      const checklist = await runCompletionChecklist({ fileNames: names, deployUrl: dep?.url || undefined, task: userTask })
      for (const c of checklist) {
        addMessage('System', `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`)
      }
      addMessage('Budi (Manager)', formatResultSummary({ intent, fileNames: names, deployUrl: dep?.url || undefined, checklist }))
      updateAgent('manager', { status: 'done', currentTask: 'Selesai' })

      const status = decideTaskStatus({
        intent,
        fileCount: names.length,
        pushErrors: pushErrors.length,
        deployUrl: dep?.url,
        verifyOk: dep?.verify ? dep.verify.ok : null,
        checklistFail: checklist.filter((c) => !c.ok).length,
      })
      const summary = buildTaskSummary({
        status,
        intent,
        files: names,
        deleted: [...pushDeleted, ...cleanDeleted],
        deployUrl: dep?.url,
        verify: dep?.verify ? `${dep.verify.status}:${dep.verify.ok ? 'ok' : 'fail'}` : null,
        checklist: `${checklist.filter((c) => c.ok).length}/${checklist.length}`,
      })
      try {
        await logTaskToSupabase(get().github?.username || 'akward', userTask, get().github?.repoFullName, summary, status)
        await get().loadTaskHistory()
      } catch { /* */ }
      addMessage('System', formatStep('done', `Status tugas: ${status}`))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addMessage('System', formatStep('error', 'Eksekusi gagal', msg))
      updateAgent('manager', { status: 'error', currentTask: 'Gagal' })
      try {
        await logTaskToSupabase(
          get().github?.username || 'akward',
          userTask,
          get().github?.repoFullName,
          buildTaskSummary({ status: 'fail', intent, error: msg }),
          'fail'
        )
        await get().loadTaskHistory()
      } catch { /* */ }
    } finally {
      set({ isRunning: false })
      get().agents.forEach((a: Agent) => { if (a.status === 'working' || a.status === 'thinking') updateAgent(a.id, { status: 'idle', currentTask: '' }) })
    }
  },

  pushArtifactsToGithub: async () => {
    const { github, artifacts, addMessage } = get()
    if (!github.token || !github.owner || !github.repo) return
    const arts = (artifacts as any[]).filter((a) => a.content && a.filename)
    if (!arts.length) return
    set({ isPushing: true })
    try {
      const files = arts.map((a) => ({ path: a.filename, content: a.content, action: a.action }))
      const pr = await pushMany({ token: github.token, owner: github.owner, repo: github.repo, branch: github.branch || 'main' }, files, 'VO AI update')
      addMessage('System', formatGitDiff({ changed: pr.ok?.length ? pr.ok : files.map((f) => f.path), deleted: pr.deleted, errors: pr.errors }))
    } finally { set({ isPushing: false }) }
  },

  saveToBackend: async (opts?: { includeGithubToken?: boolean }) => {
    set({ isSyncingSettings: true })
    try { await saveToBackendImpl({ get, set }, opts) } finally { set({ isSyncingSettings: false }) }
  },
  loadFromBackend: async () => {
    set({ isSyncingSettings: true })
    try { await loadFromBackendImpl({ get, set }) } finally { set({ isSyncingSettings: false }) }
  },
  bootstrapCloud: async () => { await bootstrapCloudSync({ get, set }) },
}))
