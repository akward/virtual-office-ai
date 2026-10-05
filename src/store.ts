import { create } from 'zustand'
import type { Agent, AppConfig, Artifact, Message } from './types'
import { callLLM, extractArtifacts } from './llm'

const defaultAgents: Agent[] = [
  { id: 'manager', name: 'Budi', role: 'Project Manager', color: '#3b82f6', emoji: '👔', status: 'idle', currentTask: '', lastMessage: 'Siap menerima tugas!', x: 18, y: 42 },
  { id: 'coder', name: 'Andi', role: 'Software Engineer', color: '#22c55e', emoji: '💻', status: 'idle', currentTask: '', lastMessage: 'Siap coding.', x: 42, y: 38 },
  { id: 'researcher', name: 'Siti', role: 'Researcher', color: '#a855f7', emoji: '🔍', status: 'idle', currentTask: '', lastMessage: 'Siap riset.', x: 66, y: 42 },
  { id: 'writer', name: 'Rina', role: 'Content Writer', color: '#f59e0b', emoji: '✍️', status: 'idle', currentTask: '', lastMessage: 'Siap menulis.', x: 30, y: 68 },
]

interface Store {
  agents: Agent[]
  messages: Message[]
  artifacts: Artifact[]
  config: AppConfig
  isRunning: boolean
  setConfig: (c: Partial<AppConfig>) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void
  addMessage: (from: string, text: string) => void
  addArtifacts: (list: Omit<Artifact, 'id' | 'createdAt'>[]) => void
  clearArtifacts: () => void
  runTask: (userTask: string) => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  agents: defaultAgents,
  messages: [],
  artifacts: [],
  config: {
    apiKey: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_api_key') || '' : '',
    baseUrl: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_base_url') || 'https://api.groq.com/openai/v1' : 'https://api.groq.com/openai/v1',
    model: typeof localStorage !== 'undefined' ? localStorage.getItem('vo_model') || 'llama-3.3-70b-versatile' : 'llama-3.3-70b-versatile',
  },
  isRunning: false,

  setConfig: (c) => {
    set((s) => {
      const next = { ...s.config, ...c }
      if (typeof localStorage !== 'undefined') {
        if (c.apiKey !== undefined) localStorage.setItem('vo_api_key', c.apiKey)
        if (c.baseUrl !== undefined) localStorage.setItem('vo_base_url', c.baseUrl)
        if (c.model !== undefined) localStorage.setItem('vo_model', c.model)
      }
      return { config: next }
    })
  },

  updateAgent: (id, patch) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

  addMessage: (from, text) => set((s) => ({
    messages: [...s.messages.slice(-60), { id: crypto.randomUUID(), from, text, timestamp: Date.now() }],
  })),

  addArtifacts: (list) => set((s) => ({
    artifacts: [...s.artifacts, ...list.map((a) => ({ ...a, id: crypto.randomUUID(), createdAt: Date.now() }))],
  })),

  clearArtifacts: () => set({ artifacts: [] }),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage, addArtifacts, clearArtifacts } = get()
    if (get().isRunning) return
    set({ isRunning: true })
    clearArtifacts()
    addMessage('Kamu', userTask)

    const collectFrom = (agentId: string, text: string) => {
      const { artifacts } = extractArtifacts(text, agentId)
      if (artifacts.length) {
        addArtifacts(artifacts.map((a) => ({ filename: a.filename, language: a.language, content: a.content, agentId })))
      }
    }

    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan...' })
      const plan = await callLLM(
        config,
        `Kamu Budi, Project Manager profesional. Jawab dalam bahasa Indonesia.
Analisis tugas user dan buat rencana kerja untuk:
- Andi (Software Engineer): coding
- Siti (Researcher): analisis
- Rina (Content Writer): dokumentasi

Format:
## Analisis
## Rencana
## Penugasan
- Andi: ...
- Siti: ...
- Rina: ...
## Deliverable`,
        userTask,
        1200
      )
      updateAgent('manager', { status: 'talking', lastMessage: plan.slice(0, 100) + (plan.length > 100 ? '...' : ''), currentTask: 'Memberi instruksi' })
      addMessage('Budi (Manager)', plan)

      const workers = [
        { id: 'coder', name: 'Andi', system: `Kamu Andi, Software Engineer. WAJIB output code block format:
\`\`\`bahasa:namafile.ext
kode
\`\`\`
Contoh: \`\`\`html:index.html
Bahasa Indonesia untuk penjelasan.` },
        { id: 'researcher', name: 'Siti', system: `Kamu Siti, Researcher. WAJIB output:
\`\`\`markdown:analysis.md
isi
\`\`\`
Bahasa Indonesia.` },
        { id: 'writer', name: 'Rina', system: `Kamu Rina, Content Writer. WAJIB output:
\`\`\`markdown:README.md
isi
\`\`\`
Bahasa Indonesia.` },
      ]

      const results: string[] = []
      for (const w of workers) {
        updateAgent(w.id, { status: 'working', currentTask: 'Mengerjakan...' })
        try {
          const result = await callLLM(
            config,
            w.system,
            `Tugas user:\n${userTask}\n\nRencana Manager:\n${plan}\n\nKerjakan bagianmu. WAJIB sertakan file dalam code block.`,
            2500
          )
          results.push(`### ${w.name}\n${result}`)
          collectFrom(w.id, result)
          updateAgent(w.id, { status: 'done', lastMessage: result.slice(0, 90) + (result.length > 90 ? '...' : ''), currentTask: 'Selesai' })
          addMessage(w.name, result)
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          updateAgent(w.id, { status: 'error', lastMessage: msg, currentTask: 'Error' })
          addMessage(w.name, `Error: ${msg}`)
        }
      }

      updateAgent('manager', { status: 'thinking', currentTask: 'Laporan akhir...' })
      const summary = await callLLM(
        config,
        `Kamu Budi, PM. Susun laporan akhir singkat (Bahasa Indonesia). Sertakan file jika relevan:
\`\`\`markdown:laporan-akhir.md
...\`\`\``,
        `Tugas: ${userTask}\n\nHasil:\n${results.join('\n\n').slice(0, 6000)}`,
        1500
      )
      collectFrom('manager', summary)
      updateAgent('manager', { status: 'done', lastMessage: summary.slice(0, 100) + (summary.length > 100 ? '...' : ''), currentTask: 'Selesai' })
      addMessage('Budi (Manager)', summary)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addMessage('System', `Error: ${msg}`)
      get().agents.forEach((a) => updateAgent(a.id, { status: 'error', lastMessage: msg }))
    } finally {
      set({ isRunning: false })
      setTimeout(() => {
        get().agents.forEach((a) => updateAgent(a.id, { status: 'idle', currentTask: '' }))
      }, 5000)
    }
  },
}))
