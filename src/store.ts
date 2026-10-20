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

  redactSecrets: (text: string) => {
    return String(text || '')
      .replace(/ghp_[A-Za-z0-9_]{20,}/g, 'ghp_***')
      .replace(/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***')
      .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***')
      .replace(/sk-or-v1-[A-Za-z0-9]{20,}/g, 'sk-or-***')
      .replace(/xai-[A-Za-z0-9]{20,}/g, 'xai-***')
      .replace(/xpl_[A-Za-z0-9]{20,}/g, 'xpl_***')
      .replace(/napi_[A-Za-z0-9]{10,}/g, 'napi_***')
      .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'jwt_***')
      .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://***')
  },
  addMessage: (from: string, text: string) => set((s: any) => ({ messages: [...s.messages, { id: crypto.randomUUID(), from, text, timestamp: Date.now()