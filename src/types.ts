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

export interface AppConfig {
  apiKey: string
  baseUrl: string
  model: string
}
