import { useState } from 'react'
import { useStore } from './store'
import { PROVIDERS } from './llm'
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
  if (!window.showDirectoryPicker) throw new Error('Gunakan Chrome/Edge untuk simpan ke folder, atau Download.')
  // @ts-expect-error File System Access API
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
  let count = 0
  for (const a of artifacts) {
    const parts = a.filename.replace(/^\/+/, '').split('/')
    let current = dirHandle
    for (let i = 0; i < parts.length - 1; i++) current = await current.getDirectoryHandle(parts[i], { create: true })
    const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(a.content)
    await writable.close()
    count++
  }
  return count + ' file disimpan ke folder lokal'
}

function Office() {
  const agents = useStore((s) => s.agents)
  return (
    <div className="office-scene">
      <div className="floor" />
      {agents.map((a) => (
        <div key={a.id}>
          <div className={`desk ${a.status === 'working' || a.status === 'thinking' ? 'monitor-on' : ''}`} style={{ left: `calc(${a.x}% - 45px)`, top: `calc(${a.y}% + 20px)` }} />
          <div className={`agent ${a.status}`} style={{ left: `${a.x}%`, top: `${a.y}%` }}>
            {(a.status === 'talking' || a.status === 'working' || a.status === 'done' || a.status === 'error') && a.lastMessage && <div className="bubble">{a.lastMessage}</div>}
            <div className="agent-name">{a.name}</div>
            <div className="agent-body" style={{ background: a.color }}>{a.emoji}<span className={`status-dot ${a.status}`} /></div>
            <div className="agent-legs" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SidePanel() {
  const { agents, messages, artifacts, config, github, isRunning, isPushing, setConfig, setGithub, connectGithub, loadContext, runTask, clearArtifacts, pushArtifactsToGithub, addMessage } = useStore()
  const [task, setTask] = useState('')
  const [showSettings, setShowSettings] = useState(!config.apiKey)
  const [showGh, setShowGh] = useState(false)
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>('groq')
  const [tab, setTab] = useState<'log' | 'files'>('log')
  const [ghBusy, setGhBusy] = useState(false)
  const [localBusy, setLocalBusy] = useState(false)

  const handleProviderChange = (p: keyof typeof PROVIDERS) => {
    setProvider(p)
    setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
  }

  const handleRun = () => {
    if (!task.trim() || isRunning) return
    setTab('log')
    runTask(task.trim())
    setTask('')
  }

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="section-head"><h2>LLM</h2>
          <button className="btn-ghost" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Sembunyikan' : 'Ubah'}</button>
        </div>
        {showSettings && (<>
          <div className="config-row"><label>Provider</label>
            <select value={provider} onChange={(e) => handleProviderChange(e.target.value as keyof typeof PROVIDERS)}>
              {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
            <p className="help-text">{PROVIDERS[provider].help}</p>
          </div>
          <div className="config-row"><label>API Key</label>
            <input type="password" value={config.apiKey} onChange={(e) => setConfig({ apiKey: e.target.value })} placeholder="Paste API key..." />
          </div>
          <div className="config-row"><label>Model</label>
            <input value={config.model} onChange={(e) => setConfig({ model: e.target.value })} />
          </div>
        </>)}
      </div>

      <div className="panel-section">
        <div className="section-head">
          <h2>GitHub {github.connected && <span className="badge-ok">● {github.repoFullName}</span>}</h2>
          <button className="btn-ghost" onClick={() => setShowGh(!showGh)}>{showGh ? 'Sembunyikan' : 'Atur'}</button>
        </div>
        {showGh && (<>
          <p className="help-text" style={{ marginBottom: 8 }}>
            Token: <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">github.com/settings/tokens</a> (scope <b>repo</b>). Hanya tersimpan di browser.
          </p>
          <div className="config-row"><label>Token</label>
            <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value, connected: false })} placeholder="ghp_..." />
          </div>
          <div className="config-row"><label>Owner</label>
            <input value={github.owner} onChange={(e) => setGithub({ owner: e.target.value, connected: false })} placeholder="username" />
          </div>
          <div className="config-row"><label>Repo</label>
            <input value={github.repo} onChange={(e) => setGithub({ repo: e.target.value, connected: false })} placeholder="my-project" />
          </div>
          <div className="config-row"><label>Branch</label>
            <input value={github.branch} onChange={(e) => setGithub({ branch: e.target.value })} placeholder="main" />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-ghost" disabled={ghBusy} onClick={async () => {
              setGhBusy(true)
              try { await connectGithub() } catch (e: unknown) { addMessage('System', e instanceof Error ? e.message : String(e)) }
              finally { setGhBusy(false) }
            }}>{ghBusy ? '...' : github.connected ? 'Hubungkan ulang' : 'Hubungkan'}</button>
            {github.connected && <button className="btn-ghost" onClick={() => loadContext().catch((e) => addMessage('System', String(e)))}>Muat konteks</button>}
          </div>
        </>)}
      </div>

      <div className="panel-section">
        <h2>Berikan Tugas</h2>
        <textarea className="task-input" value={task} onChange={(e) => setTask(e.target.value)}
          placeholder={github.connected ? 'Contoh: Perbaiki UI, update README...' : 'Contoh: Buat landing page + README...'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun() }} />
        <button className="btn btn-primary" disabled={isRunning || !task.trim() || !config.apiKey} onClick={handleRun}>
          {isRunning ? 'Agent bekerja...' : 'Kirim ke Tim AI'}
        </button>
      </div>

      <div className="panel-section">
        <h2>Status Agent</h2>
        <div className="agent-list">
          {agents.map((a) => (
            <div key={a.id} className="agent-item">
              <span className="emoji">{a.emoji}</span>
              <div className="info"><div className="name">{a.name}</div><div className="role">{a.role}</div></div>
              <span className="status-label" style={{ color: a.status === 'working' || a.status === 'done' ? 'var(--green)' : a.status === 'error' ? 'var(--red)' : a.status === 'thinking' || a.status === 'talking' ? 'var(--yellow)' : 'var(--muted)' }}>{a.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: 'none' }}>
        <div className="tabs">
          <button className={tab === 'log' ? 'tab active' : 'tab'} onClick={() => setTab('log')}>Log</button>
          <button className={tab === 'files' ? 'tab active' : 'tab'} onClick={() => setTab('files')}>File ({artifacts.length})</button>
        </div>
        {tab === 'log' && (
          <div className="messages">
            {messages.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Hubungkan GitHub (opsional), isi API key, kirim tugas.</div>}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.from === 'System' ? 'system' : ''}`}>
                <div className="msg-from">{m.from}</div>
                <div className="msg-text">{m.text}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'files' && (
          <div className="files-panel">
            {artifacts.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Belum ada file.</div>
            ) : (<>
              <div className="files-actions">
                <button className="btn-ghost" onClick={() => downloadAll(artifacts)}>Download</button>
                <button className="btn-ghost" disabled={localBusy} onClick={async () => {
                  setLocalBusy(true)
                  try { addMessage('System', await saveToLocalFolder(artifacts)); setTab('log') }
                  catch (e: unknown) { addMessage('System', e instanceof Error ? e.message : String(e)) }
                  finally { setLocalBusy(false) }
                }}>{localBusy ? '...' : 'Ke folder lokal'}</button>
                <button className="btn-ghost" disabled={!github.connected || isPushing} onClick={async () => {
                  try { await pushArtifactsToGithub(); setTab('log') }
                  catch (e: unknown) { addMessage('System', e instanceof Error ? e.message : String(e)) }
                }}>{isPushing ? 'Push...' : 'Push GitHub'}</button>
                <button className="btn-ghost" onClick={clearArtifacts}>Hapus</button>
              </div>
              {artifacts.map((f) => (
                <div key={f.id} className="file-item">
                  <div className="file-meta"><span className="file-name">{f.filename}</span><span className="file-agent">{f.agentId}</span></div>
                  <pre className="file-preview">{f.content.slice(0, 280)}{f.content.length > 280 ? '…' : ''}</pre>
                  <button className="btn-ghost" onClick={() => downloadFile(f.filename, f.content)}>Download</button>
                </div>
              ))}
            </>)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="app">
      <div className="office-wrap">
        <div className="office-header">
          <h1>Virtual Office AI Pro</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>GitHub · Local folder · Multi-agent</span>
        </div>
        <Office />
      </div>
      <SidePanel />
    </div>
  )
}
