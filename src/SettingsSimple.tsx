/** Settings sederhana — tab seperti ChatGPT / Grok */
import { useState } from 'react'
import { useStore } from './store'
import { PROVIDERS, SETUP_PRESETS, detectProviderFromBaseUrl, type SetupPresetId } from './llm'
import { ConnectorsPanel } from './ConnectorsPanel'

type Tab = 'ai' | 'connectors' | 'project' | 'memory'

export function SettingsSimple({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    config, setConfig, github, setGithub, connectWithToken, selectRepo, createNewRepo,
    isLoadingRepos, isCreatingRepo, repos, addMessage, powerMode, setPowerMode,
    agentMemory, teachAgent, clearMemory, saveToBackend, loadFromBackend, isSyncingSettings,
  } = useStore()

  const [tab, setTab] = useState<Tab>('ai')
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>(() => detectProviderFromBaseUrl(config.baseUrl))
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(false)

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
            <p className="help-text">Pilih model, tempel API key. Selesai.</p>
            <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(SETUP_PRESETS) as SetupPresetId[]).map((id) => (
                <button key={id} type="button" className="btn-ghost"
                  style={detectProviderFromBaseUrl(config.baseUrl) === id ? { outline: '2px solid #3b82f6', fontWeight: 600 } : undefined}
                  onClick={() => {
                    const pre = SETUP_PRESETS[id]
                    setProvider(id === 'gemini' || id === 'groq' || id === 'openrouter' ? id : 'custom')
                    setConfig({ baseUrl: pre.primary.baseUrl, model: pre.primary.model, baseUrl2: pre.secondary.baseUrl, model2: pre.secondary.model })
                  }}>
                  {id === 'gemini' ? 'Gemini' : id === 'groq' ? 'Groq' : 'OpenRouter'}
                </button>
              ))}
            </div>
            <label className="field-label">Provider</label>
            <select value={provider} onChange={(e) => {
              const p = e.target.value as keyof typeof PROVIDERS
              setProvider(p)
              setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
            }}>
              {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
            <label className="field-label">API Key</label>
            <input type="password" value={config.apiKey} onChange={(e) => setConfig({ apiKey: e.target.value })} placeholder="Paste API key" />
            <label className="field-label">Model</label>
            <input value={config.model} onChange={(e) => setConfig({ model: e.target.value })} />
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
              <input type="checkbox" checked={powerMode} onChange={(e) => setPowerMode(e.target.checked)} /> Full Power agents
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
            <p className="help-text">Hubungkan layanan. Klik kartu → isi → Connect.</p>
            <ConnectorsPanel />
          </section>
        )}

        {tab === 'project' && (
          <section className="side-block">
            <p className="help-text">Repo aktif untuk agent bekerja.</p>
            <label className="field-label">GitHub token</label>
            <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_..." />
            <button type="button" className="btn-primary" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
              try { await connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
            }}>{isLoadingRepos ? '...' : github.connected ? `Refresh @${github.username}` : 'Connect GitHub'}</button>
            {github.token.trim() && (<>
              <label className="field-label">Repository</label>
              <select value={github.repoFullName} onChange={async (e) => {
                try { await selectRepo(e.target.value) } catch (err: unknown) { addMessage('System', String(err)) }
              }}>
                <option value="">— choose repo —</option>
                {repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}
              </select>
              <label className="field-label">New repo</label>
              <input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="name" />
              <label className="row-actions">
                <input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} /> Private
              </label>
              <button type="button" className="btn-ghost" disabled={isCreatingRepo || !newRepoName.trim()} onClick={async () => {
                try { await createNewRepo(newRepoName.trim(), { private: newRepoPrivate }); setNewRepoName('') }
                catch (e: unknown) { addMessage('System', String(e)) }
              }}>{isCreatingRepo ? '...' : 'Create repo'}</button>
              <label className="row-actions">
                <input type="checkbox" checked={github.autoPush} onChange={(e) => setGithub({ autoPush: e.target.checked })} /> Auto-push
              </label>
            </>)}
          </section>
        )}

        {tab === 'memory' && (
          <section className="side-block">
            <p className="help-text">Pref {agentMemory.prefs.length} · lessons {agentMemory.lessons.length} · skills {(agentMemory.skills || []).length}</p>
            <button type="button" className="btn-ghost" onClick={() => {
              const t = window.prompt('Lesson for agents:')
              if (t?.trim()) { teachAgent(t.trim()); addMessage('System', '📚 ' + t.trim()) }
            }}>+ Add lesson</button>
            <button type="button" className="btn-ghost" onClick={() => { if (window.confirm('Reset memory?')) clearMemory() }}>Reset memory</button>
            <p className="help-text">Chat: skill list · skillify · skill tambah Nama: aturan</p>
          </section>
        )}
      </div>
    </aside>
  )
}
