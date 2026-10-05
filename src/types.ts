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

export interface RepoInfo {
  full_name: string
  name: string
  owner: string
  private: boolean
  default_branch: string
  description: string
  html_url: string
  updated_at: string
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

export interface Artifact {
  id: string
  filename: string
  language: string
  content: string
  agentId: string
  createdAt: number
}
