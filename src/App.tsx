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
        <div
          key={a.id}
          className={`agent-sprite ${a.status}`}
          style={{ left: `${a.x}%`, top: `${a.y}%` }}
          title={`${a.name} — ${a.role}`}
        >
          <div className="agent-body" style={{ background: a.color }}>
            {a.emoji}
            <span className={`status-dot ${a.status}`} />
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
    setConfig, setGithub, connectWithToken, selectRepo, createNewRepo, loadContext,
    runTask, clearArtifacts, pushArtifactsToGithub, addMessage,
    connectors, setConnectors, initOAuthCallback, connectGmail,
  } = useStore()
  const [task, setTask] = useState('')
  const [showSettings, setShowSettings] = useState(!config.apiKey)

  useEffect(() => {
    initOAuthCallback().catch(() => {})
  }, [])

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
          <label className="field-label">Provider</label>
          <select value={provider} onChange={(e) => {
            const p = e.target.value as keyof typeof PROVIDERS
            setProvider(p)
            setConfig({ baseUrl: PROVIDERS[p].baseUrl, model: PROVIDERS[p].models[0] })
          }}>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <label className="field-label">API Key</label>
          <input type="password" value={config.apiKey} onChange={(e) => setConfig({ apiKey: e.target.value })} placeholder="API key..." />
          <label className="field-label">Model</label>
          <input value={config.model} onChange={(e) => setConfig({ model: e.target.value })} />
          <p className="help-text">{PROVIDERS[provider]?.help}</p>
        </>)}
      </div>

      <div className="panel-section">
        <div className="section-head">
          <h2>GitHub {github.connected && <span className="badge-ok">● @{github.username} · {repos.length} repo</span>}</h2>
          <button className="btn-ghost" onClick={() => setShowGh(!showGh)}>{showGh ? 'Sembunyikan' : 'Ubah'}</button>
        </div>
        {showGh && (<>
          <p className="help-text">PAT scope <b>repo</b> — <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">buat token</a></p>
          <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_..." />
          <button className="btn-ghost" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
            try { await connectWithToken() } catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isLoadingRepos ? 'Memuat...' : github.connected ? 'Refresh repo' : 'Hubungkan'}</button>
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
                try {
                  await createNewRepo(newRepoName.trim(), { private: newRepoPrivate })
                  setNewRepoName('')
                } catch (e: unknown) { addMessage('System', String(e)) }
              }}>{isCreatingRepo ? 'Membuat...' : 'Buat repo baru'}</button>
            </div>
            <label className="row-actions">
              <input type="checkbox" checked={github.autoPush} onChange={(e) => setGithub({ autoPush: e.target.checked })} />
              Auto-push ke GitHub setelah selesai
            </label>
          </>)}
        </>)}
      </div>

      <div className="panel-section">
        <div className="section-head"><h2>Konektor</h2></div>
        <p className="help-text">
          Agent bisa kirim notifikasi. Format: <code>SEND_EMAIL: to@mail.com | subject | isi</code>,{' '}
          <code>SEND_TELEGRAM: pesan</code>, <code>SEND_SLACK: pesan</code>
        </p>
        <label className="field-label">Gmail — OAuth Client ID</label>
        <input type="text" value={connectors.gmailClientId} onChange={(e) => setConnectors({ gmailClientId: e.target.value })} placeholder="xxxx.apps.googleusercontent.com" />
        <p className="help-text">
          Buat OAuth Client (Web) di{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a>.
          Aktifkan Gmail API. Redirect URI = URL app ini.
        </p>
        <div className="row-actions">
          <button className="btn-ghost" disabled={!connectors.gmailClientId.trim()} onClick={async () => {
            try { await connectGmail() } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)) }
          }}>{connectors.gmailAccessToken ? 'Hubungkan ulang Gmail' : 'Hubungkan Gmail'}</button>
          {connectors.gmailAccessToken && <span className="badge-ok">● {connectors.gmailEmail || 'Gmail OK'}</span>}
        </div>
        <label className="field-label">Telegram Bot Token</label>
        <input type="password" value={connectors.telegramBotToken} onChange={(e) => setConnectors({ telegramBotToken: e.target.value })} placeholder="123456:ABC..." />
        <label className="field-label">Telegram Chat ID</label>
        <input type="text" value={connectors.telegramChatId} onChange={(e) => setConnectors({ telegramChatId: e.target.value })} placeholder="Chat ID" />
        <label className="field-label">Slack Incoming Webhook</label>
        <input type="password" value={connectors.slackWebhookUrl} onChange={(e) => setConnectors({ slackWebhookUrl: e.target.value })} placeholder="https://hooks.slack.com/..." />
        <label className="field-label">Discord Webhook</label>
        <input type="password" value={connectors.discordWebhookUrl} onChange={(e) => setConnectors({ discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." />
        <label className="field-label">Webhook generik</label>
        <input type="password" value={connectors.genericWebhookUrl} onChange={(e) => setConnectors({ genericWebhookUrl: e.target.value })} placeholder="https://..." />
      </div>

      <div className="panel-section">
        <h2>Tugas</h2>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={github.repoFullName ? `Tugas untuk ${github.repoFullName}...` : 'Hubungkan GitHub dulu'}
          rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun() }}
        />
        <button className="btn btn-primary" disabled={isRunning || !task.trim() || !config.apiKey || !github.repoFullName} onClick={handleRun}>
          {isRunning ? 'Agent bekerja...' : github.autoPush ? 'Jalankan + Auto Push' : 'Kirim ke Tim AI'}
        </button>
      </div>

      <div className="panel-section">
        <div className="tabs">
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Log</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files ({artifacts.length})</button>
        </div>
        {tab === 'log' && (
          <div className="log-box">
            {messages.map((m) => (
              <div key={m.id} className="log-line">
                <strong>{m.from}</strong>
                <pre>{m.text}</pre>
              </div>
            ))}
          </div>
        )}
        {tab === 'files' && (
          <div className="files-panel">
            <div className="row-actions">
              <button className="btn-ghost" disabled={!artifacts.length} onClick={() => downloadAll(artifacts)}>Download</button>
              <button className="btn-ghost" disabled={!artifacts.length || localBusy} onClick={async () => {
                setLocalBusy(true)
                try {
                  const n = await saveToLocalFolder(artifacts)
                  addMessage('System', `Disimpan ${n} file ke folder lokal`)
                } catch (e: unknown) { addMessage('System', String(e)) }
                finally { setLocalBusy(false) }
              }}>Simpan lokal</button>
              <button className="btn-ghost" disabled={!github.repoFullName || isPushing || !artifacts.length} onClick={async () => {
                try { await pushArtifactsToGithub() } catch (e: unknown) { addMessage('System', String(e)) }
              }}>{isPushing ? 'Push...' : 'Push GitHub'}</button>
              <button className="btn-ghost" disabled={!artifacts.length} onClick={() => clearArtifacts()}>Clear</button>
            </div>
            {artifacts.map((a) => (
              <div key={a.id} className="file-item">
                <span className="emoji">{a.action === 'delete' ? '🗑️' : '📄'}</span>
                <code>{a.filename}</code>
                <button className="btn-ghost" onClick={() => downloadFile(a.filename, a.content)}>↓</button>
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
          <p>Multi-agent · GitHub · Konektor</p>
        </div>
        <OfficeFloor />
      </div>
      <SidePanel />
    </div>
  )
}
