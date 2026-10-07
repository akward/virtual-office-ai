import { saveSettingsToBackend, loadSettingsFromBackend, type BackendSettings } from './settingsBackend'
import { saveMemory } from './agentMemory'
import { getAuthenticatedUser } from './github'

type GetSet = { get: () => any; set: (p: any) => void }

export async function saveToBackendImpl(
  { get, set }: GetSet,
  opts?: { includeGithubToken?: boolean }
) {
  const { github, config, powerMode, agentMemory, connectors, addMessage } = get()
  if (!github.token.trim()) throw new Error('Hubungkan GitHub dulu untuk menyimpan ke backend.')
  let username = github.username
  if (!username) username = await getAuthenticatedUser(github.token)
  set({ isSyncingSettings: true })
  try {
    const payload: BackendSettings = {
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
    const { url } = await saveSettingsToBackend(github.token, username, payload)
    addMessage('System', `☁️ Pengaturan disimpan ke backend. ${url}`)
  } finally {
    set({ isSyncingSettings: false })
  }
}

export async function loadFromBackendImpl({ get, set }: GetSet) {
  const { github, setConfig, setGithub, setPowerMode, setConnectors, addMessage } = get()
  if (!github.token.trim()) throw new Error('Hubungkan GitHub dulu.')
  let username = github.username
  if (!username) username = await getAuthenticatedUser(github.token)
  set({ isSyncingSettings: true })
  try {
    const data = await loadSettingsFromBackend(github.token, username)
    if (!data) {
      addMessage('System', 'Belum ada pengaturan di backend. Klik Simpan ke backend dulu.')
      return
    }
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
    addMessage('System', `☁️ Pengaturan dimuat dari backend (${data.savedAt || 'ok'}).`)
  } finally {
    set({ isSyncingSettings: false })
  }
}
