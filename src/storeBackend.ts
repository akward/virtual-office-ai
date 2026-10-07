import { saveSettingsToBackend, loadSettingsFromBackend, type BackendSettings } from './settingsBackend'
import { saveMemory } from './agentMemory'
import { getAuthenticatedUser } from './github'
import {
  isSupabaseConfigured,
  loadSupabaseConfig,
  upsertVoSettings,
  loadVoSettings,
  insertVoTask,
} from './supabase'

type GetSet = { get: () => any; set: (p: any) => void }

function buildPayload(get: () => any, username: string, opts?: { includeGithubToken?: boolean }): BackendSettings {
  const { github, config, powerMode, agentMemory, connectors } = get()
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    config: { ...config },
    github: {
      owner: github.owner,
      repo: github.repo,
      branch: github.branch,
      connected: github.connected,
      repoFullName: github.repoFullName,
      username,
      autoPush: github.autoPush,
      ...(opts?.includeGithubToken ? { token: github.token } : {}),
    },
    powerMode,
    agentMemory,
    connectors: {
      gmailClientId: connectors.gmailClientId,
      telegramBotToken: connectors.telegramBotToken,
      telegramChatId: connectors.telegramChatId,
      gmailEmail: connectors.gmailEmail,
    },
  }
}

function applyPayload(get: () => any, set: (p: any) => void, data: BackendSettings, username: string) {
  const { setConfig, setGithub, setPowerMode, setConnectors, addMessage } = get()
  if (data.config) setConfig({ ...data.config, extraKeys: data.config.extraKeys || [] })
  if (data.powerMode !== undefined) setPowerMode(!!data.powerMode)
  if (data.agentMemory) {
    saveMemory(data.agentMemory)
    set({ agentMemory: data.agentMemory })
  }
  if (data.connectors) setConnectors(data.connectors)
  if (data.github) {
    setGithub({
      owner: data.github.owner || get().github.owner,
      repo: data.github.repo || get().github.repo,
      branch: data.github.branch || 'main',
      repoFullName: data.github.repoFullName || get().github.repoFullName,
      username: data.github.username || username,
      autoPush: data.github.autoPush !== false,
      ...(data.github.token ? { token: data.github.token } : {}),
    })
  }
  addMessage('System', `☁️ Pengaturan dimuat (${data.savedAt || 'ok'}).`)
}

export async function saveToBackendImpl(
  { get, set }: GetSet,
  opts?: { includeGithubToken?: boolean }
) {
  const { github, addMessage } = get()
  set({ isSyncingSettings: true })
  try {
    let username = github.username
    if (!username && github.token.trim()) {
      username = await getAuthenticatedUser(github.token)
    }
    if (!username) username = 'default'

    const payload = buildPayload(get, username, opts)
    const sb = loadSupabaseConfig()

    if (isSupabaseConfigured(sb)) {
      await upsertVoSettings(sb, username, payload)
      addMessage('System', `☁️ Disimpan ke Supabase (user: ${username}).`)
      return
    }

    if (!github.token.trim()) {
      throw new Error('Isi Supabase URL+Key, atau hubungkan GitHub untuk backend alternatif.')
    }
    const { url } = await saveSettingsToBackend(github.token, username, payload)
    addMessage('System', `☁️ Disimpan ke GitHub backend. ${url}`)
  } finally {
    set({ isSyncingSettings: false })
  }
}

export async function loadFromBackendImpl({ get, set }: GetSet) {
  const { github, addMessage } = get()
  set({ isSyncingSettings: true })
  try {
    let username = github.username
    if (!username && github.token.trim()) {
      username = await getAuthenticatedUser(github.token)
    }
    if (!username) username = 'default'

    const sb = loadSupabaseConfig()
    if (isSupabaseConfigured(sb)) {
      const raw = await loadVoSettings(sb, username)
      if (!raw) {
        addMessage('System', 'Supabase: belum ada data. Klik Simpan ke database dulu.')
        return
      }
      applyPayload(get, set, raw as BackendSettings, username)
      return
    }

    if (!github.token.trim()) {
      throw new Error('Isi Supabase URL+Key, atau hubungkan GitHub.')
    }
    const data = await loadSettingsFromBackend(github.token, username)
    if (!data) {
      addMessage('System', 'Belum ada pengaturan di backend.')
      return
    }
    applyPayload(get, set, data, username)
  } finally {
    set({ isSyncingSettings: false })
  }
}

export async function logTaskToSupabase(userKey: string, task: string, repo?: string, summary?: string) {
  const sb = loadSupabaseConfig()
  if (!isSupabaseConfigured(sb)) return
  await insertVoTask(sb, {
    user_key: userKey || 'default',
    repo,
    task,
    result_summary: summary,
  })
}
