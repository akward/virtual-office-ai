import { useState, useEffect, useRef } from 'react'
import { useStore } from './store'
import { SettingsSimple } from './SettingsSimple'
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

function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages, artifacts, config, github, isRunning, isPushing, runTask, clearArtifacts, pushArtifactsToGithub, addMessage, powerMode } = useStore()
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
      {!config.apiKey && <p className="help-text" style={{ padding: '0.5rem' }}>Settings → AI → paste API key</p>}
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
      <SettingsSimple open={leftOpen} onClose={() => setLeftOpen(false)} />
      <main className="main-stage">
        <div className="office-header">
          <h1>Virtual Office AI</h1>
          <p>{github.repoFullName ? <>Repo: <b>{github.repoFullName}</b></> : 'Settings → AI / Connectors'}</p>
        </div>
        <OfficeFloor />
      </main>
      <ChatSidebar open={rightOpen} onClose={() => setRightOpen(false)} />
      {!rightOpen && <button type="button" className="rail-toggle rail-right" onClick={() => setRightOpen(true)}>💬</button>}
    </div>
  )
}
