/** Persist Office Agent settings to a private GitHub repo (backend). */
import { createRepo, getFile, putFile, listAllRepos, type GitHubConfig } from './github'
import type { AppConfig, AgentMemory, GitHubSettings } from './types'
import type { ConnectorConfig } from './connectors'

export const SETTINGS_REPO = 'vo-user-settings'
export const SETTINGS_PATH = 'settings.json'

export type BackendSettings = {
  version: 1
  savedAt: string
  config: AppConfig
  github: Omit<GitHubSettings, 'token'> & { token?: string }
  powerMode: boolean
  agentMemory: AgentMemory
  connectors: Partial<ConnectorConfig>
}

/** Pastikan repo privat vo-user-settings ada */
export async function ensureSettingsRepo(token: string, username: string): Promise<GitHubConfig> {
  const repos = await listAllRepos(token)
  const found = repos.find((r) => r.name === SETTINGS_REPO || r.full_name === `${username}/${SETTINGS_REPO}`)
  if (found) {
    return {
      token,
      owner: found.owner || username,
      repo: found.name,
      branch: found.default_branch || 'main',
    }
  }
  const created = await createRepo(token, SETTINGS_REPO, {
    description: 'Virtual Office AI — pengaturan tersimpan (private)',
    private: true,
    auto_init: true,
  })
  return {
    token,
    owner: created.owner || username,
    repo: created.name,
    branch: created.default_branch || 'main',
  }
}

export async function saveSettingsToBackend(
  token: string,
  username: string,
  payload: BackendSettings
): Promise<{ url: string }> {
  const cfg = await ensureSettingsRepo(token, username)
  const body: BackendSettings = {
    ...payload,
    version: 1,
    savedAt: new Date().toISOString(),
  }
  await putFile(cfg, SETTINGS_PATH, JSON.stringify(body, null, 2), 'Update Virtual Office settings')
  return { url: `https://github.com/${cfg.owner}/${cfg.repo}/blob/${cfg.branch}/${SETTINGS_PATH}` }
}

export async function loadSettingsFromBackend(
  token: string,
  username: string
): Promise<BackendSettings | null> {
  const cfg = await ensureSettingsRepo(token, username)
  const f = await getFile(cfg, SETTINGS_PATH)
  if (!f?.content) return null
  try {
    const data = JSON.parse(f.content) as BackendSettings
    if (!data || data.version !== 1) return null
    return data
  } catch {
    return null
  }
}
