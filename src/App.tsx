import { useState } from 'react'
import { useStore } from './store'
import { PROVIDERS } from './llm'
import './App.css'

function Office() {
  const agents = useStore((s) => s.agents)

  return (
    <div className="office-scene">
      <div className="floor" />
      {agents.map((a) => (
        <div key={a.id}>
          <div
            className={`desk ${a.status === 'working' || a.status === 'thinking' ? 'monitor-on' : ''}`}
            style={{ left: `calc(${a.x}% - 45px)`, top: `calc(${a.y}% + 20px)` }}
          />
          <div
            className={`agent ${a.status}`}
            style={{ left: `${a.x}%`, top: `${a.y}%` }}
          >
            {(a.status === 'talking' || a.status === 'working' || a.status === 'done' || a.status === 'error') &&
              a.lastMessage && (
                <div className="bubble">{a.lastMessage}</div>
              )}
            <div className="agent-name">{a.name}</div>
            <div className="agent-body" style={{ background: a.color }}>
              {a.emoji}
              <span className={`status-dot ${a.status}`} />
            </div>
            <div className="agent-legs" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SidePanel() {
  const {
    agents,
    messages,
    config,
    isRunning,
    setConfig,
    runTask,
  } = useStore()
  const [task, setTask] = useState('')
  const [showSettings, setShowSettings] = useState(!config.apiKey)
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>('groq')

  const handleProviderChange = (p: keyof typeof PROVIDERS) => {
    setProvider(p)
    const info = PROVIDERS[p]
    setConfig({
      baseUrl: info.baseUrl,
      model: info.models[0],
    })
  }

  const handleRun = () => {
    if (!task.trim() || isRunning) return
    runTask(task.trim())
    setTask('')
  }

  return (
    <div className="panel">
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Pengaturan LLM</h2>
          <button className="btn-ghost" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? 'Sembunyikan' : 'Ubah'}
          </button>
        </div>
        {showSettings && (
          <>
            <div className="config-row">
              <label>Provider</label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as keyof typeof PROVIDERS)}
              >
                {Object.entries(PROVIDERS).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
              <p className="help-text">{PROVIDERS[provider].help}</p>
            </div>
            <div className="config-row">
              <label>API Key</label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig({ apiKey: e.target.value })}
                placeholder="Paste API key di sini..."
              />
            </div>
            <div className="config-row">
              <label>Base URL</label>
              <input
                value={config.baseUrl}
                onChange={(e) => setConfig({ baseUrl: e.target.value })}
              />
            </div>
            <div className="config-row">
              <label>Model</label>
              <input
                value={config.model}
                onChange={(e) => setConfig({ model: e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="panel-section">
        <h2>Berikan Tugas</h2>
        <textarea
          className="task-input"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Contoh: Buatkan rencana landing page untuk produk AI..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun()
          }}
        />
        <button
          className="btn btn-primary"
          disabled={isRunning || !task.trim() || !config.apiKey}
          onClick={handleRun}
        >
          {isRunning ? 'Agent sedang bekerja...' : 'Kirim ke Tim AI'}
        </button>
        {!config.apiKey && (
          <p className="help-text" style={{ marginTop: 8, color: 'var(--yellow)' }}>
            Isi API Key dulu di pengaturan di atas.
          </p>
        )}
      </div>

      <div className="panel-section">
        <h2>Status Agent</h2>
        <div className="agent-list">
          {agents.map((a) => (
            <div key={a.id} className="agent-item">
              <span className="emoji">{a.emoji}</span>
              <div className="info">
                <div className="name">{a.name}</div>
                <div className="role">{a.role}</div>
              </div>
              <span
                className="status-label"
                style={{
                  color:
                    a.status === 'working' || a.status === 'done'
                      ? 'var(--green)'
                      : a.status === 'error'
                      ? 'var(--red)'
                      : a.status === 'thinking' || a.status === 'talking'
                      ? 'var(--yellow)'
                      : 'var(--muted)',
                }}
              >
                {a.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: 'none' }}>
        <h2>Log Aktivitas</h2>
        <div className="messages">
          {messages.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              Belum ada aktivitas. Kirim tugas untuk mulai.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.from === 'System' ? 'system' : ''}`}>
              <div className="msg-from">{m.from}</div>
              <div className="msg-text">{m.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="app">
      <div className="office-wrap">
        <div className="office-header">
          <h1>Virtual Office AI</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Multi-agent · Pixel office
          </span>
        </div>
        <Office />
      </div>
      <SidePanel />
    </div>
  )
}
