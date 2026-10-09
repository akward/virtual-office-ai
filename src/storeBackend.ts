import { saveSettingsToBackend, loadSettingsFromBackend, type BackendSettings } from './settingsBackend'
import { saveMemory } from './agentMemory'
import { getAuthenticatedUser } from './github'
import {
  isSupabaseConfigured,
  loadSupabaseConfig,
  saveSupabaseConfig,
  upsertVoSettings,
  loadVoSettings,
  insertVoTask,
  loadSbProfiles,
  saveSbProfiles,
  setActiveSbId,
  getActiveSbId,
  loadVercelProfiles,
  saveVercelProfiles,
  setActiveVercelId,
  getActiveVercelId,
  EXAMPLE_SB_PROFILES,
} from './supabase'

type GetSet = { get: () => any; set: (p: any) => void }

const CLOUD_USER_KEY = 'vo_cloud_user'
export const SHARED_CLOUD_KEYS = ['akward', 'default'] as const

export function getCloudUserKey(githubUsername?: string): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(CLOUD_USER_KEY)
    if (saved?.trim()) return saved.trim()
  }
  if (githubUsername?.trim()) return githubUsername.trim()
  return 'akward'
}

export function setCloudUserKey(key: string) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(CLOUD_USER_KEY, key.trim() || 'akward')
}

function buildPayload(get: () => any, username: string, opts?: { includeGithubToken?: boolean }): BackendSettings {
  const { github, config, powerMode, agentMemory, connectors } = get()
  const sb = loadSupabaseConfig()
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
      ...(opts?.includeGithubToken !== false && github.token ? { token: github.token } : {}),
    },
    powerMode,
    agentMemory,
    connectors: {
      gmailClientId: connectors.gmailClientId,
      telegramBotToken: connectors.telegramBotToken,
      telegramChatId: connectors.telegramChatId,
      gmailEmail: connectors.gmailEmail,
      slackWebhookUrl: connectors.slackWebhookUrl,
      discordWebhookUrl: connectors.discordWebhookUrl,
      genericWebhookUrl: connectors.genericWebhookUrl,
      neonApiKey: connectors.neonApiKey,
      neonConnectionString: connectors.neonConnectionString,
      notionToken: connectors.notionToken,
      cloudflareToken: connectors.cloudflareToken,
      cloudflareAccountId: connectors.cloudflareAccountId,
    },
    supabase: sb.url && sb.anonKey ? {
      url: sb.url.replace(/\/$/, ''),
      anonKey: sb.anonKey,
    } : undefined,
    sbProfiles: loadSbProfiles(),
    sbActiveId: getActiveSbId(),
    vercelProfiles: loadVercelProfiles().map((p) => ({ ...p })),
    vercelActiveId: getActiveVercelId(),
  } as BackendSettings
}

function applyPayload(get: () => any, set: (p: any) => void, data: BackendSettings, username: string, silent?: boolean) {
  const { setConfig, setGithub, setPowerMode, setConnectors, addMessage } = get()
  if (data.config) {
    setConfig({
      ...data.config,
      extraKeys: data.config.extraKeys || [],
      vercelToken: data.config.vercelToken || '',
    })
  }
  if (data.powerMode !== undefined) setPowerMode(!!data.powerMode)
  if (data.agentMemory) {
    const mem = {
      lessons: data.agentMemory.lessons || [],
      prefs: data.agentMemory.prefs || [],
      skills: data.agentMemory.skills || [],
    }
    saveMemory(mem)
    set({ agentMemory: mem })
  }
  if (data.connectors) setConnectors(data.connectors)
  if (data.github) {
    const tok = data.github.token || get().github.token || ''
    const uname = data.github.username || username || get().github.username || ''
    setGithub({
      owner: data.github.owner || get().github.owner || uname,
      repo: data.github.repo || get().github.repo,
      branch: data.github.branch || 'main',
      repoFullName: data.github.repoFullName || get().github.repoFullName,
      username: uname,
      autoPush: data.github.autoPush !== false,
      token: tok,
      connected: Boolean(tok) || Boolean(data.github.connected),
    })
  }
  const anyData = data as any
  if (Array.isArray(anyData.sbProfiles) && anyData.sbProfiles.length) {
    saveSbProfiles(anyData.sbProfiles)
    if (anyData.sbActiveId) setActiveSbId(anyData.sbActiveId)
  }
  if (data.supabase?.url && data.supabase?.anonKey) {
    saveSupabaseConfig({ url: data.supabase.url, anonKey: data.supabase.anonKey })
  }
  if (Array.isArray(anyData.vercelProfiles) && anyData.vercelProfiles.length) {
    saveVercelProfiles(anyData.vercelProfiles)
    if (anyData.vercelActiveId) setActiveVercelId(anyData.vercelActiveId)
    const active = anyData.vercelProfiles.find((p: any) => p.id === anyData.vercelActiveId)
    if (active?.token && !data.config?.vercelToken) {
      setConfig({ vercelToken: active.token })
    }
  }
  setCloudUserKey(username)
  if (!silent) {
    const bits: string[] = []
    if (data.config?.apiKey || data.config?.apiKey2) bits.push('API')
    if (data.config?.vercelToken || anyData.vercelProfiles?.length) bits.push('Vercel')
    if (data.github?.token) bits.push('GitHub')
    if (data.supabase?.anonKey || anyData.sbProfiles?.length) bits.push('Supabase')
    addMessage(
      'System',
      bits.length
        ? `☁️ Cloud dimuat (${username}): ${bits.join(', ')} siap multi-device.`
        : `☁️ Setting cloud dimuat (${username}).`
    )
  }
}

async function loadFromSupabaseAny(
  sb: ReturnType<typeof loadSupabaseConfig>,
  preferred: string
): Promise<{ raw: unknown; key: string } | null> {
  const keys = Array.from(new Set([preferred, ...SHARED_CLOUD_KEYS]))
  for (const key of keys) {
    try {
      const raw = await loadVoSettings(sb, key)
      if (raw && typeof raw === 'object') return { raw, key }
    } catch {
      /* next */
    }
  }
  return null
}

export async function saveToBackendImpl(
  { get, set }: GetSet,
  opts?: { includeGithubToken?: boolean; silent?: boolean }
) {
  const { github, addMessage } = get()
  set({ isSyncingSettings: true })
  try {
    let username = getCloudUserKey(github.username)
    if (github.token?.trim() && !github.username) {
      try {
        username = await getAuthenticatedUser(github.token)
        setCloudUserKey(username)
      } catch {
        /* keep */
      }
    }

    const payload = buildPayload(get, username, {
      includeGithubToken: opts?.includeGithubToken !== false,
    })
    const sb = loadSupabaseConfig()

    if (isSupabaseConfigured(sb)) {
      await upsertVoSettings(sb, username, payload)
      if (username !== 'default') {
        try {
          await upsertVoSettings(sb, 'default', payload)
        } catch {
          /* mirror optional */
        }
      }
      if (!opts?.silent) {
        const hasV = Boolean(payload.config?.vercelToken)
        addMessage(
          'System',
          hasV
            ? `☁️ Disimpan ke cloud (${username}): API + Vercel + Supabase.`
            : `☁️ Disimpan ke cloud (user: ${username}).`
        )
      }
      return
    }

    if (!github.token?.trim()) {
      throw new Error('Supabase belum siap. Refresh halaman atau isi URL+Key di Settings.')
    }
    const { url } = await saveSettingsToBackend(github.token, username, payload)
    if (!opts?.silent) addMessage('System', `☁️ Disimpan ke GitHub backend. ${url}`)
  } finally {
    set({ isSyncingSettings: false })
  }
}

export async function loadFromBackendImpl({ get, set }: GetSet, opts?: { silent?: boolean }) {
  const { github, addMessage } = get()
  set({ isSyncingSettings: true })
  try {
    let username = getCloudUserKey(github.username)
    if (github.token?.trim() && !github.username) {
      try {
        username = await getAuthenticatedUser(github.token)
      } catch {
        /* */
      }
    }

    const sb = loadSupabaseConfig()
    if (isSupabaseConfigured(sb)) {
      const found = await loadFromSupabaseAny(sb, username)
      if (!found) {
        if (!opts?.silent) addMessage('System', 'Cloud: belum ada setting. Isi API/Vercel lalu tersimpan otomatis.')
        return
      }
      applyPayload(get, set, found.raw as BackendSettings, found.key, opts?.silent)
      return
    }

    if (!github.token?.trim()) {
      if (!opts?.silent) addMessage('System', 'Isi Supabase atau GitHub token untuk sync antar device.')
      return
    }
    const data = await loadSettingsFromBackend(github.token, username)
    if (!data) {
      if (!opts?.silent) addMessage('System', 'Belum ada pengaturan di backend.')
      return
    }
    applyPayload(get, set, data, username, opts?.silent)
  } finally {
    set({ isSyncingSettings: false })
  }
}

export async function bootstrapCloudSync({ get, set }: GetSet) {
  try {
    try {
      const list = loadSbProfiles()
      if (!list.length && EXAMPLE_SB_PROFILES.length) {
        saveSbProfiles(EXAMPLE_SB_PROFILES)
        setActiveSbId(EXAMPLE_SB_PROFILES[0].id)
      } else if (list.length && !getActiveSbId()) {
        setActiveSbId(list[0].id)
      }
    } catch {
      /* */
    }

    await loadFromBackendImpl({ get, set }, { silent: false })

    const st = get()
    if (st.github?.token && typeof st.connectWithToken === 'function') {
      try {
        await st.connectWithToken()
      } catch (e) {
        console.warn('auto github reconnect', e)
        if (st.setGithub) st.setGithub({ connected: true })
      }
    }
  } catch (e: unknown) {
    console.warn('bootstrapCloudSync', e)
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleCloudSave(getSet: GetSet) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveToBackendImpl(getSet, { includeGithubToken: true, silent: true }).catch((e) => {
      console.warn('auto-save cloud', e)
    })
  }, 1200)
}

export async function logTaskToSupabase(userKey: string, task: string, repo?: string, summary?: string) {
  const sb = loadSupabaseConfig()
  if (!isSupabaseConfigured(sb)) return
  await insertVoTask(sb, {
    user_key: userKey || getCloudUserKey() || 'default',
    repo,
    task,
    result_summary: summary,
  })
}
