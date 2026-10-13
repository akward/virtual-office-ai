/** Settings sederhana — sinkron provider dari baseUrl */
import { useMemo, useState } from 'react'
import { useStore } from './store'
import { PROVIDERS, SETUP_PRESETS, detectProviderFromBaseUrl, type SetupPresetId } from './llm'
import { ConnectorsPanel } from './ConnectorsPanel'

type Tab = 'ai' | 'connectors' | 'project' | 'memory'

const PRESET_LABEL: Record<string, string> = {
  xai: 'xAI Grok',
  explabs: 'Qwen (ExpLabs)',
  gemini: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
}

export function SettingsSimple({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    config, setConfig, github, setGithub, connectWithToken, selectRepo, createNewRepo,
    isLoadingRepos, isCreatingRepo, repos, addMessage, powerMode, setPowerMode,
    agentMemory, teachAgent, clearMemory, saveToBackend, loadFromBackend, isSyncingSettings,
  } = useStore()

  const [tab, setTab] = useState<Tab>('ai')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(false)

  const activePreset = useMemo(
    () => detectProviderFromBaseUrl(config.baseUrl || ''),
    [config.baseUrl]
  )
  const providerKey = (activePreset in PROVIDERS ? activePreset : Object.keys(PROVIDERS)[0]) as keyof typeof PROVIDERS

  const applyPreset = (id: SetupPresetId) => {
    const pre = SETUP_PRESETS[id]
    if (!pre) return
    setConfig({
      baseUrl: pre.primary.baseUrl,
      model: pre.primary.model,
      baseUrl2: pre.secondary.baseUrl,
      model2: pre.secondary.model,
    })
  }

  return (
    <aside className={`sidebar sidebar-left ${open ? 'open' : 'collapsed'}`}>
      <div className="sidebar-header">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={onClose} title="Hide">«</button>
      </div>

      <div className="settings-tabs">
        {([['ai', 'AI'], ['connectors', 'Connectors'], ['project', 'Project'], ['memory', 'Memory']] as const).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="sidebar-scroll">
        {tab === 'ai' && (
          <section className="side-block">
            <p className="help-text">Tombol biru = provider aktif (ikut Base URL). Lalu Save to cloud.</p>
            <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(SETUP_PRESETS) as SetupPresetId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn-ghost"
                  style={activePreset === id ? { outline: '2px solid #3b82f6', fontWeight: 600 } : undefined}
                  onClick={() => applyPreset(id)}
                >
                  {PRESET_LABEL[id] || id}
                </button>
              ))}
            </div>

            <label className="field-label">Provider</label>
            <select
              value={providerKey}
              onChange={(e) => {
                const p = e.target.value as keyof typeof PROVIDERS
                setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
              }}
            >
              {Object.entries(PROVIDERS).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>

            <label className="field-label">Base URL</label>
            <input
              value={config.baseUrl || ''}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="https://api...."
            />

            <label className="field-label">API Key</label>
            <input
              type="password"
              value={config.apiKey || ''}
              onChange={(e) => setConfig({ apiKey: e.target.value })}
              placeholder="Paste API key"
            />

            <label className="field-label">Model</label>
            <input
              value={config.model || ''}
              onChange={(e) => setConfig({ model: e.target.value })}
              list="vo-model-suggestions"
            />
            <datalist id="vo-model-suggestions">
              {(PROVIDERS[providerKey]?.models || []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <details className="settings-advanced">
              <summary>Advanced (fallback key)</summary>
              <label className="field-label">API Key #2</label>
              <input type="password" value={config.apiKey2 || ''} onChange={(e) => setConfig({ apiKey2: e.target.value })} placeholder="Optional fallback" />
              <label className="field-label">Base URL #2</label>
              <input value={config.baseUrl2 || ''} onChange={(e) => setConfig({ baseUrl2: e.target.value })} />
              <label className="field-label">Model #2</label>
              <input value={config.model2 || ''} onChange={(e) => setConfig({ model2: e.target.value })} />
            </details>

            <label className="row-actions">
              <input type="checkbox" checked={!!powerMode} onChange={(e) => setPowerMode(e.target.checked)} /> Full Power agents
            </label>
            <div className="row-actions">
              <button type="button" className="btn-ghost" disabled={isSyncingSettings} onClick={() => saveToBackend({ includeGithubToken: true }).catch((e) => addMessage('System', String(e)))}>
                {isSyncingSettings ? '...' : '☁ Save to cloud'}
              </button>
              <button type="button" className="btn-ghost" disabled={isSyncingSettings} onClick={() => loadFromBackend().catch((e) => addMessage('System', String(e)))}>↓ Load</button>
            </div>
          </section>
        )}

        {tab === 'connectors' && (
          <section className="side-block">
            <ConnectorsPanel />
          </section>
        )}

        {tab === 'project' && (
          <section className="side-block">
            <p className="help-text">GitHub token + pilih repo.</p>
            <label className="field-label">GitHub Token</label>
            <input type="password" value={github.token || ''} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_..." />
            <button type="button" className="btn-primary" disabled={isLoadingRepos} onClick={() => connectWithToken().catch((e) => addMessage('System', String(e)))}>
              {isLoadingRepos ? '...' : 'Login GitHub'}
            </button>
            {github.connected && (
              <>
                <label className="field-label">Repo</label>
                <select value={github.repoFullName || ''} onChange={(e) => selectRepo(e.target.value)}>
                  <option value="">— pilih —</option>
                  {(repos || []).map((r: any) => (
                    <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
                  ))}
                </select>
                <label className="field-label">Repo baru</label>
                <input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="nama-repo" />
                <label className="row-actions">
                  <input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} /> Private
                </label>
                <button type="button" className="btn-ghost" disabled={isCreatingRepo || !newRepoName.trim()} onClick={() => createNewRepo(newRepoName.trim(), { private: newRepoPrivate }).catch((e) => addMessage('System', String(e)))}>
                  {isCreatingRepo ? '...' : 'Buat repo baru'}
                </button>
                <label className="row-actions">
                  <input type="checkbox" checked={github.autoPush !== false} onChange={(e) => setGithub({ autoPush: e.target.checked })} /> Auto-push
                </label>
              </>
            )}
            <label className="field-label">Vercel Token</label>
            <input type="password" value={config.vercelToken || ''} onChange={(e) => setConfig({ vercelToken: e.target.value })} placeholder="vercel token" />
          </section>
        )}

        {tab === 'memory' && (
          <section className="side-block">
            <p className="help-text">Ajari agent / lihat skill.</p>
            <button type="button" className="btn-ghost" onClick={() => {
              const lesson = prompt('Pelatihan untuk agent:')
              if (lesson?.trim()) teachAgent(lesson.trim())
            }}>Tambah pelajaran</button>
            <button type="button" className="btn-ghost" onClick={() => clearMemory()}>Hapus memori</button>
            <pre className="help-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {JSON.stringify(agentMemory, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </aside>
  )
}
