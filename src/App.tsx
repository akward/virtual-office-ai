import { useState, useEffect } from 'react'
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
          <div className="agent-body" style={{ background: a.color }}>
            {a.emoji}<span className={`status-dot ${a.status}`} />
          </div>
          <div className="agent-label">{a.name}</div>
          {a.currentTask && <div className="speech">{a.currentTask}</div>}
        </div>
      ))}
    </div>
  )
}

function SidePanel() {
  const {
    agents, messages, artifacts, config, github, repos,
    isRunning, isPushing, isLoadingRepos, isCreatingRepo,
    setConfig, setGithub, connectWithToken, selectRepo, createNewRepo,
    runTask, clearArtifacts, pushArtifactsToGithub, addMessage,
    connectors, setConnectors, initOAuthCallback, connectGmail, powerMode, setPowerMode,
  } = useStore()
  const [task, setTask] = useState('')
  const [showSettings, setShowSettings] = useState(!config.apiKey)
  useEffect(() => { initOAuthCallback().catch(() => {}) }, [])
  const [showGh, setShowGh] = useState(true)
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>('groq')
  const [tab, setTab] = useState<'log' | 'files'>('log')
  const [localBusy, setLocalBusy] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(false)
  const filteredRepos = repos.filter((r) => !repoFilter || r.full_name.toLowerCase().includes(repoFilter.toLowerCase()))

  const handleRun = () => {
    if (!task.trim() || isRunning) return
    setTab('log')
    runTask(task.trim())
    setTask('')
  }

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="section-head">
          <h2>LLM Settings</h2>
          <button className="btn-ghost" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Sembunyikan' : 'Ubah'}</button>
        </div>
        {showSettings && (<>
          <select value={provider} onChange={(e) => {
            const p = e.target.value as keyof typeof PROVIDERS
            setProvider(p)
            setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
          }}>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <input type="password" value={config.apiKey} onChange={(e) => setConfig({ apiKey: e.target.value })} placeholder="API key..." />
          <input value={config.model} onChange={(e) => setConfig({ model: e.target.value })} />
          <p className="help-text">{PROVIDERS[provider]?.help}</p>
        </>)}
      </div>

      <div className="panel-section">
        <div className="section-head">
          <h2>GitHub {github.connected && <span className="badge-ok">● @{github.username}</span>}</h2>
          <button className="btn-ghost" onClick={() => setShowGh(!showGh)}>{showGh ? 'Sembunyikan' : 'Ubah'}</button>
        </div>
        {showGh && (<>
          <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_..." />
          <button className="btn-ghost" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
            try { await connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isLoadingRepos ? 'Memuat...' : 'Hubungkan / Refresh'}</button>
          {github.token.trim() && (<>
            <input value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} placeholder="Filter repo..." />
            <select value={github.repoFullName} onChange={async (e) => {
              try { await selectRepo(e.target.value) } catch (err: unknown) { addMessage('System', String(err)) }
            }}>
              <option value="">— pilih repo —</option>
              {filteredRepos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}
            </select>
            <div className="row-actions">
              <input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="nama-repo-baru" />
              <label><input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} /> Private</label>
              <button className="btn-ghost" disabled={isCreatingRepo || !newRepoName.trim()} onClick={async () => {
                try { await createNewRepo(newRepoName.trim(), { private: newRepoPrivate }); setNewRepoName('') }
                catch (e: unknown) { addMessage('System', String(e)) }
              }}>{isCreatingRepo ? '...' : 'Buat repo'}</button>
            </div>
            <label className="row-actions">
              <input type="checkbox" checked={github.autoPush} onChange={(e) => setGithub({ autoPush: e.target.checked })} />
              Auto-push GitHub
            </label>
          </>)}
        </>)}
      </div>

      <div className="panel-section">
        <h2>Konektor</h2>
        <p className="help-text"><code>SEND_EMAIL: to | subject | body</code> · <code>SEND_TELEGRAM: pesan</code></p>
        <input type="text" value={connectors.gmailClientId} onChange={(e) => setConnectors({ gmailClientId: e.target.value })} placeholder="Gmail OAuth Client ID" />
        <div className="row-actions">
          <button className="btn-ghost" disabled={!connectors.gmailClientId.trim()} onClick={async () => {
            try { await connectGmail() } catch (e: unknown) { alert(String(e)) }
          }}>{connectors.gmailAccessToken ? 'Reconnect Gmail' : 'Hubungkan Gmail'}</button>
          {connectors.gmailAccessToken && <span className="badge-ok">● {connectors.gmailEmail || 'OK'}</span>}
        </div>
        <input type="password" value={connectors.telegramBotToken} onChange={(e) => setConnectors({ telegramBotToken: e.target.value })} placeholder="Telegram bot token" />
        <input type="text" value={connectors.telegramChatId} onChange={(e) => setConnectors({ telegramChatId: e.target.value })} placeholder="Telegram chat ID" />
        <input type="password" value={connectors.slackWebhookUrl} onChange={(e) => setConnectors({ slackWebhookUrl: e.target.value })} placeholder="Slack webhook" />
        <input type="password" value={connectors.discordWebhookUrl} onChange={(e) => setConnectors({ discordWebhookUrl: e.target.value })} placeholder="Discord webhook" />
      </div>

      <div className="panel-section">
        <h2>Tugas</h2>
        <label className="row-actions">
          <input type="checkbox" checked={powerMode} onChange={(e) => setPowerMode(e.target.checked)} />
          <span>⚡ Full Power (konteks lebih luas, token lebih besar, agent senior)</span>
        </label>
        <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder={github.repoFullName ? `Tugas untuk ${github.repoFullName}...` : 'Hubungkan GitHub dulu'} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun() }} />
        <button className="btn btn-primary" disabled={isRunning || !task.trim() || !config.apiKey || !github.repoFullName} onClick={handleRun}>
          {isRunning ? 'Agent bekerja...' : powerMode ? '⚡ Jalankan Full Power' : 'Kirim ke Tim AI'}
        </button>
      </div>

      <div className="panel-section">
        <div className="tabs">
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Log</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files ({artifacts.length})</button>
        </div>
        {tab === 'log' && (
          <div className="log-box">{messages.map((m) => (
            <div key={m.id} className="log-line"><strong>{m.from}</strong><pre>{m.text}</pre></div>
          ))}</div>
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
              <div key={a.id} className="file-item">
                <span>{a.action === 'delete' ? '🗑️' : '📄'}</span>
                <code>{a.filename}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="app-shell">
      <div className="office-wrap">
        <div className="office-header">
          <h1>Virtual Office AI</h1>
          <p>Full Power · Multi-agent · GitHub · Konektor</p>
        </div>
        <OfficeFloor />
      </div>
      <SidePanel />
    </div>
  )
}
