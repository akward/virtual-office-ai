import { useState, useEffect, useRef } from 'react'
import { useStore } from './store'
import { PROVIDERS, SETUP_PRESETS, detectProviderFromBaseUrl, type SetupPresetId } from './llm'
import './App.css'

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.split('/').pop() || filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadAll(artifacts: { filename: string; content: string }[]) {
  artifacts.forEach((a, i) => setTimeout(() => downloadFile(a.filename, a.content), i * 200))
}

async function saveToLocalFolder(artifacts: { filename: string; content: string }[]) {
  // @ts-expect-error File System Access API
  if (!window.showDirectoryPicker) throw new Error('Gunakan Chrome/Edge atau Download.')
  // @ts-expect-error File System Access API
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
  let count = 0
  for (const a of artifacts) {
    const parts = a.filename.replace(/^\/+/, '').split('/')
    let current = dirHandle
    for (let i = 0; i < parts.length - 1; i++) current = await current.getDirectoryHandle(parts[i], { create: true })
    const fh = await current.getFileHandle(parts[parts.length - 1], { create: true })
    const w = await fh.createWritable()
    await w.write(a.content)
    await w.close()
    count++
  }
  return count
}

function OfficeFloor() {
  const agents = useStore((s) => s.agents)
  return (
    <div className="office-scene">
      <div className="floor-grid" />
      {agents.map((a) => (
        <div key={a.id} className={`agent-sprite ${a.status}`} style={{ left: `${a.x}%`, top: `${a.y}%` }} title={`${a.name} — ${a.role}`}>
          <div className="agent-body" style={{ background: a.color }}>{a.emoji}<span className={`status-dot ${a.status}`} /></div>
          <div className="agent-label">{a.name}</div>
          {a.currentTask && <div className="speech">{a.currentTask}</div>}
        </div>
      ))}
    </div>
  )
}

function SettingsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    config, github, repos, isLoadingRepos, isCreatingRepo, isRunning,
    setConfig, setGithub, connectWithToken, selectRepo, createNewRepo, addMessage,
    connectors, setConnectors, connectGmail, powerMode, setPowerMode, runTask,
    agentMemory, teachAgent, clearMemory,
    saveToBackend, loadFromBackend, isSyncingSettings,
  } = useStore()
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>(() =>
    detectProviderFromBaseUrl(config.baseUrl)
  )
  const [repoFilter, setRepoFilter] = useState('')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(false)
  const filteredRepos = repos.filter((r) => !repoFilter || r.full_name.toLowerCase().includes(repoFilter.toLowerCase()))
  const extras = config.extraKeys || []

  return (
    <aside className={`sidebar sidebar-left ${open ? 'open' : 'collapsed'}`}>
      <div className="sidebar-header">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={onClose} title="Sembunyikan">«</button>
      </div>
      <div className="sidebar-scroll">
        <section className="side-block">
          <h3>LLM — API utama</h3>
          <p className="help-text">Pilih setup default, lalu tempel API Key.</p>
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(Object.keys(SETUP_PRESETS) as SetupPresetId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="btn-ghost"
                style={detectProviderFromBaseUrl(config.baseUrl) === id ? { outline: '2px solid #3b82f6', fontWeight: 600 } : undefined}
                onClick={() => {
                  const pre = SETUP_PRESETS[id]
                  setProvider(id === 'gemini' || id === 'groq' || id === 'openrouter' ? id : 'custom')
                  setConfig({
                    baseUrl: pre.primary.baseUrl,
                    model: pre.primary.model,
                    baseUrl2: pre.secondary.baseUrl,
                    model2: pre.secondary.model,
                  })
                }}
              >
                {id === 'gemini' ? '⭐ Gemini' : id === 'groq' ? '⚡ Groq' : '🔀 OpenRouter'}
              </button>
            ))}
          </div>
          <label className="field-label">Provider / API utama</label>
          <select value={provider} onChange={(e) => {
            const p = e.target.value as keyof typeof PROVIDERS
            setProvider(p)
            setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
          }}>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <label className="field-label">API Key #1 (utama)</label>
          <input type="password" value={config.apiKey} onChange={(e) => setConfig({ apiKey: e.target.value })} placeholder="Tempel API Key" />
          <label className="field-label">Base URL #1</label>
          <input value={config.baseUrl} onChange={(e) => setConfig({ baseUrl: e.target.value })} />
          <label className="field-label">Model #1</label>
          <input value={config.model} onChange={(e) => setConfig({ model: e.target.value })} />
          <p className="help-text">{PROVIDERS[provider]?.help}</p>
          <label className="field-label">API Key #2 (fallback)</label>
          <input type="password" value={config.apiKey2 || ''} onChange={(e) => setConfig({ apiKey2: e.target.value })} />
          <input value={config.baseUrl2 || ''} onChange={(e) => setConfig({ baseUrl2: e.target.value })} placeholder="Base URL #2" />
          <input value={config.model2 || ''} onChange={(e) => setConfig({ model2: e.target.value })} placeholder="Model #2" />
          <label className="field-label">API Key tambahan</label>
          {extras.map((ek, idx) => (
            <div key={ek.id} style={{ border: '1px solid #333', borderRadius: 8, padding: '0.5rem', marginBottom: '0.5rem' }}>
              <input value={ek.label} onChange={(e) => {
                const next = [...extras]; next[idx] = { ...ek, label: e.target.value }; setConfig({ extraKeys: next })
              }} placeholder="Label" />
              <input type="password" value={ek.apiKey} onChange={(e) => {
                const next = [...extras]; next[idx] = { ...ek, apiKey: e.target.value }; setConfig({ extraKeys: next })
              }} placeholder="API Key" />
              <input value={ek.baseUrl} onChange={(e) => {
                const next = [...extras]; next[idx] = { ...ek, baseUrl: e.target.value }; setConfig({ extraKeys: next })
              }} placeholder="Base URL" />
              <input value={ek.model} onChange={(e) => {
                const next = [...extras]; next[idx] = { ...ek, model: e.target.value }; setConfig({ extraKeys: next })
              }} placeholder="Model" />
              <button type="button" className="btn-ghost" onClick={() => setConfig({ extraKeys: extras.filter((x) => x.id !== ek.id) })}>✕ Hapus</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setConfig({
            extraKeys: [...extras, { id: crypto.randomUUID(), label: `Key #${extras.length + 3}`, apiKey: '', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' }],
          })}>➕ Tambah API Key</button>
          <label className="field-label">Vercel Token</label>
          <input type="password" value={config.vercelToken || ''} onChange={(e) => setConfig({ vercelToken: e.target.value })} />
          <label className="row-actions">
            <input type="checkbox" checked={powerMode} onChange={(e) => setPowerMode(e.target.checked)} /> ⚡ Full Power
          </label>
        </section>

        <section className="side-block">
          <h3>Backend (simpan pengaturan)</h3>
          <p className="help-text">
            Disimpan ke repo privat <code>vo-user-settings</code> di GitHub (settings.json).
            Termasuk API key. Wajib login GitHub.
          </p>
          <button type="button" className="btn-ghost" disabled={isSyncingSettings || !github.token.trim()} onClick={async () => {
            try { await saveToBackend({ includeGithubToken: true }) }
            catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isSyncingSettings ? 'Menyimpan...' : '☁️ Simpan ke backend'}</button>
          <button type="button" className="btn-ghost" disabled={isSyncingSettings || !github.token.trim()} onClick={async () => {
            try { await loadFromBackend() }
            catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isSyncingSettings ? 'Memuat...' : '⬇️ Muat dari backend'}</button>
        </section>

        <section className="side-block">
          <h3>Latih Agent</h3>
          <p className="help-text">Memori: {agentMemory.prefs.length} pref, {agentMemory.lessons.length} pelajaran</p>
          <button className="btn-ghost" type="button" onClick={() => {
            const t = window.prompt('Pelajaran:')
            if (t?.trim()) { teachAgent(t.trim()); addMessage('System', '📚 ' + t.trim()) }
          }}>➕ Tambah pelajaran</button>
          <button className="btn-ghost" type="button" onClick={() => { if (window.confirm('Reset memori?')) clearMemory() }}>🗑️ Reset</button>
        </section>

        <section className="side-block">
          <h3>GitHub {github.connected && <span className="badge-ok">● @{github.username}</span>}</h3>
          <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_..." />
          <button className="btn-ghost" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
            try { await connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isLoadingRepos ? 'Memuat...' : 'Hubungkan / Refresh'}</button>
          {github.token.trim() && (<>
            <select value={github.repoFullName} onChange={async (e) => {
              try { await selectRepo(e.target.value) } catch (err: unknown) { addMessage('System', String(err)) }
            }}>
              <option value="">— pilih repo —</option>
              {filteredRepos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}
            </select>
            <div className="row-actions">
              <input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="nama-repo-baru" />
              <label><input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} /> Private</label>
            </div>
            <button className="btn-ghost" disabled={isCreatingRepo || !newRepoName.trim()} onClick={async () => {
              try { await createNewRepo(newRepoName.trim(), { private: newRepoPrivate }); setNewRepoName('') }
              catch (e: unknown) { addMessage('System', String(e)) }
            }}>{isCreatingRepo ? '...' : 'Buat repo'}</button>
            <label className="row-actions">
              <input type="checkbox" checked={github.autoPush} onChange={(e) => setGithub({ autoPush: e.target.checked })} /> Auto-push
            </label>
          </>)}
        </section>

        <section className="side-block">
          <h3>Konektor</h3>
          <input type="text" value={connectors.gmailClientId} onChange={(e) => setConnectors({ gmailClientId: e.target.value })} placeholder="Gmail OAuth Client ID" />
          <button className="btn-ghost" disabled={!connectors.gmailClientId.trim()} onClick={async () => {
            try { await connectGmail() } catch (e: unknown) { alert(String(e)) }
          }}>{connectors.gmailAccessToken ? 'Reconnect Gmail' : 'Hubungkan Gmail'}</button>
          <input type="password" value={connectors.telegramBotToken} onChange={(e) => setConnectors({ telegramBotToken: e.target.value })} placeholder="Telegram bot token" />
          <input type="text" value={connectors.telegramChatId} onChange={(e) => setConnectors({ telegramChatId: e.target.value })} placeholder="Telegram chat ID" />
        </section>
      </div>
    </aside>
  )
}

function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    messages, artifacts, config, github, isRunning, isPushing,
    runTask, clearArtifacts, pushArtifactsToGithub, addMessage, powerMode,
  } = useStore()
  const [task, setTask] = useState('')
  const [tab, setTab] = useState<'log' | 'files'>('log')
  const [localBusy, setLocalBusy] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const handleRun = () => {
    if (!task.trim() || isRunning) return
    setTab('log')
    runTask(task.trim())
    setTask('')
  }
  return (
    <aside className={`sidebar sidebar-right ${open ? 'open' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button type="button" className="icon-btn" onClick={onClose}>»</button>
        <h2>Chat & Tugas</h2>
      </div>
      <div className="chat-compose">
        <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3}
          placeholder={github.repoFullName ? `Tugas untuk ${github.repoFullName}…` : 'Tugas…'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun() }} />
        <button className="btn btn-primary" disabled={isRunning || !task.trim()} onClick={handleRun}>
          {isRunning ? 'Agent bekerja...' : powerMode ? '⚡ Jalankan' : 'Kirim'}
        </button>
      </div>
      <div className="tabs">
        <button type="button" className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Log</button>
        <button type="button" className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files ({artifacts.length})</button>
      </div>
      {tab === 'log' && (
        <div className="log-box">
          {messages.map((m) => (
            <div key={m.id} className="log-line"><strong>{m.from}</strong><pre>{m.text}</pre></div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
      {tab === 'files' && (
        <div className="files-panel">
          <div className="row-actions">
            <button className="btn-ghost" disabled={!artifacts.length} onClick={() => downloadAll(artifacts)}>Download</button>
            <button className="btn-ghost" disabled={!artifacts.length || localBusy} onClick={async () => {
              setLocalBusy(true)
              try { addMessage('System', `Disimpan ${await saveToLocalFolder(artifacts)} file`) }
              catch (e: unknown) { addMessage('System', String(e)) }
              finally { setLocalBusy(false) }
            }}>Lokal</button>
            <button className="btn-ghost" disabled={!github.repoFullName || isPushing || !artifacts.length} onClick={async () => {
              try { await pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', String(e)) }
            }}>{isPushing ? '...' : 'Push'}</button>
            <button className="btn-ghost" disabled={!artifacts.length} onClick={() => clearArtifacts()}>Clear</button>
          </div>
          {artifacts.map((a) => (
            <div key={a.id} className="file-item"><span>{a.action === 'delete' ? '🗑️' : '📄'}</span><code>{a.filename}</code></div>
          ))}
        </div>
      )}
      {!config.apiKey && <p className="help-text" style={{ padding: '0.5rem' }}>Pilih ⭐ Gemini lalu isi API Key #1. Simpan ke backend agar tidak hilang.</p>}
    </aside>
  )
}

export default function App() {
  const initOAuthCallback = useStore((s) => s.initOAuthCallback)
  const github = useStore((s) => s.github)
  const [leftOpen, setLeftOpen] = useState(() => typeof localStorage === 'undefined' ? true : localStorage.getItem('vo_left_open') !== '0')
  const [rightOpen, setRightOpen] = useState(() => typeof localStorage === 'undefined' ? true : localStorage.getItem('vo_right_open') !== '0')
  useEffect(() => { initOAuthCallback().catch(() => {}) }, [initOAuthCallback])
  useEffect(() => { localStorage.setItem('vo_left_open', leftOpen ? '1' : '0') }, [leftOpen])
  useEffect(() => { localStorage.setItem('vo_right_open', rightOpen ? '1' : '0') }, [rightOpen])
  return (
    <div className="app-shell">
      {!leftOpen && <button type="button" className="rail-toggle rail-left" onClick={() => setLeftOpen(true)}>⚙</button>}
      <SettingsSidebar open={leftOpen} onClose={() => setLeftOpen(false)} />
      <main className="main-stage">
        <div className="office-header">
          <h1>Virtual Office AI</h1>
          <p>{github.repoFullName ? <>Repo: <b>{github.repoFullName}</b></> : 'Settings → API + Backend'}</p>
        </div>
        <OfficeFloor />
      </main>
      <ChatSidebar open={rightOpen} onClose={() => setRightOpen(false)} />
      {!rightOpen && <button type="button" className="rail-toggle rail-right" onClick={() => setRightOpen(true)}>💬</button>}
    </div>
  )
}
