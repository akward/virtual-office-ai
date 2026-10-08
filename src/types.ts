export type AgentStatus = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error'

export interface Agent {
  id: string
  name: string
  role: string
  color: string
  emoji: string
  status: AgentStatus
  currentTask: string
  lastMessage: string
  x: number
  y: number
}

export interface Message {
  id: string
  from: string
  text: string
  timestamp: number
}

export interface Artifact {
  id: string
  filename: string
  language: string
  content: string
  agentId: string
  createdAt: number
  action?: 'upsert' | 'delete'
}

export interface ExtraApiKey {
  id: string
  label: string
  apiKey: string
  baseUrl: string
  model: string
}

export interface AppConfig {
  apiKey: string
  baseUrl: string
  model: string
  apiKey2: string
  baseUrl2: string
  model2: string
  vercelToken: string
  /** API key tambahan (3, 4, ...) */
  extraKeys: ExtraApiKey[]
}

export interface GitHubSettings {
  token: string
  owner: string
  repo: string
  branch: string
  connected: boolean
  repoFullName: string
  username: string
  autoPush: boolean
}

export interface RepoInfo {
  name: string
  full_name: string
  owner: string
  default_branch: string
  private: boolean
  html_url: string
  description: string | null
}

/** Preferensi & pelajaran yang diajarkan user ke agent */
export interface AgentLesson {
  id: string
  text: string
  createdAt: number
}

/** Skill reusable ala oh-my-claudecode — auto-inject saat trigger cocok */
export interface AgentSkill {
  id: string
  name: string
  description: string
  /** Kata kunci / frasa yang memicu skill */
  triggers: string[]
  /** Isi skill (aturan / pola yang wajib diikuti) */
  body: string
  /** manual | extracted | seeded */
  source: 'manual' | 'extracted' | 'seeded'
  createdAt: number
  hits?: number
}

export interface AgentMemory {
  lessons: AgentLesson[]
  prefs: string[]
  skills: AgentSkill[]
}
