import { create } from 'zustand'
import type { Agent, AppConfig, Message } from './types'
import { callLLM } from './llm'

const defaultAgents: Agent[] = [
  {
    id: 'manager',
    name: 'Budi',
    role: 'Project Manager',
    color: '#3b82f6',
    emoji: '👔',
    status: 'idle',
    currentTask: '',
    lastMessage: 'Siap menerima tugas!',
    x: 18,
    y: 42,
  },
  {
    id: 'coder',
    name: 'Andi',
    role: 'Software Engineer',
    color: '#22c55e',
    emoji: '💻',
    status: 'idle',
    currentTask: '',
    lastMessage: 'Siap coding.',
    x: 42,
    y: 38,
  },
  {
    id: 'researcher',
    name: 'Siti',
    role: 'Researcher',
    color: '#a855f7',
    emoji: '🔍',
    status: 'idle',
    currentTask: '',
    lastMessage: 'Siap riset.',
    x: 66,
    y: 42,
  },
  {
    id: 'writer',
    name: 'Rina',
    role: 'Content Writer',
    color: '#f59e0b',
    emoji: '✍️',
    status: 'idle',
    currentTask: '',
    lastMessage: 'Siap menulis.',
    x: 30,
    y: 68,
  },
]

interface Store {
  agents: Agent[]
  messages: Message[]
  config: AppConfig
  isRunning: boolean
  setConfig: (c: Partial<AppConfig>) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void
  addMessage: (from: string, text: string) => void
  runTask: (userTask: string) => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  agents: defaultAgents,
  messages: [],
  config: {
    apiKey: localStorage.getItem('vo_api_key') || '',
    baseUrl: localStorage.getItem('vo_base_url') || 'https://api.groq.com/openai/v1',
    model: localStorage.getItem('vo_model') || 'llama-3.3-70b-versatile',
  },
  isRunning: false,

  setConfig: (c) => {
    set((s) => {
      const next = { ...s.config, ...c }
      if (c.apiKey !== undefined) localStorage.setItem('vo_api_key', c.apiKey)
      if (c.baseUrl !== undefined) localStorage.setItem('vo_base_url', c.baseUrl)
      if (c.model !== undefined) localStorage.setItem('vo_model', c.model)
      return { config: next }
    })
  },

  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  addMessage: (from, text) =>
    set((s) => ({
      messages: [
        ...s.messages.slice(-40),
        { id: crypto.randomUUID(), from, text, timestamp: Date.now() },
      ],
    })),

  runTask: async (userTask: string) => {
    const { config, updateAgent, addMessage } = get()
    if (get().isRunning) return
    set({ isRunning: true })
    addMessage('Kamu', userTask)

    try {
      updateAgent('manager', { status: 'thinking', currentTask: 'Merencanakan tugas...' })
      const plan = await callLLM(
        config,
        `Kamu adalah Project Manager bernama Budi. Jawab singkat dalam bahasa Indonesia.
Tugas user: "${userTask}"
Buat rencana singkat (3-5 langkah) dan tentukan siapa yang mengerjakan (Coder/Andi, Researcher/Siti, Writer/Rina).
Format:
Rencana:
1. ...
2. ...
Penugasan: Coder → ..., Researcher → ..., Writer → ...`,
        userTask
      )
      updateAgent('manager', {
        status: 'talking',
        lastMessage: plan.slice(0, 120) + (plan.length > 120 ? '...' : ''),
        currentTask: 'Memberi instruksi',
      })
      addMessage('Budi (Manager)', plan)

      const workers = [
        {
          id: 'coder',
          name: 'Andi',
          prompt: `Kamu Andi, Software Engineer. Berdasarkan rencana berikut, kerjakan bagian coding/teknis. Jawab singkat & praktis dalam bahasa Indonesia.\n\n${plan}`,
        },
        {
          id: 'researcher',
          name: 'Siti',
          prompt: `Kamu Siti, Researcher. Berdasarkan rencana berikut, lakukan riset/analisis yang dibutuhkan. Jawab singkat dalam bahasa Indonesia.\n\n${plan}`,
        },
        {
          id: 'writer',
          name: 'Rina',
          prompt: `Kamu Rina, Content Writer. Berdasarkan rencana berikut, tulis ringkasan/dokumentasi yang dibutuhkan. Jawab singkat dalam bahasa Indonesia.\n\n${plan}`,
        },
      ]

      const results: string[] = []
      for (const w of workers) {
        updateAgent(w.id, { status: 'working', currentTask: 'Mengerjakan tugas...' })
        try {
          const result = await callLLM(
            config,
            w.prompt,
            `Kerjakan bagianmu untuk tugas: ${userTask}`
          )
          results.push(`### ${w.name}\n${result}`)
          updateAgent(w.id, {
            status: 'done',
            lastMessage: result.slice(0, 100) + (result.length > 100 ? '...' : ''),
            currentTask: 'Selesai',
          })
          addMessage(w.name, result)
        } catch (e: any) {
          updateAgent(w.id, { status: 'error', lastMessage: e.message, currentTask: 'Error' })
          addMessage(w.name, `Error: ${e.message}`)
        }
      }

      updateAgent('manager', { status: 'thinking', currentTask: 'Merangkum hasil...' })
      const summary = await callLLM(
        config,
        `Kamu Budi, Project Manager. Rangkum hasil kerja tim berikut menjadi laporan singkat & jelas dalam bahasa Indonesia.`,
        results.join('\n\n')
      )
      updateAgent('manager', {
        status: 'done',
        lastMessage: summary.slice(0, 120) + (summary.length > 120 ? '...' : ''),
        currentTask: 'Selesai',
      })
      addMessage('Budi (Manager)', summary)
    } catch (e: any) {
      addMessage('System', `Error: ${e.message}`)
      get().agents.forEach((a) =>
        updateAgent(a.id, { status: 'error', lastMessage: e.message })
      )
    } finally {
      set({ isRunning: false })
      setTimeout(() => {
        get().agents.forEach((a) =>
          updateAgent(a.id, { status: 'idle', currentTask: '' })
        )
      }, 4000)
    }
  },
}))
