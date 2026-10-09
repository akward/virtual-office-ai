/** Panel Connectors bergaya kartu (mirip Grok / ChatGPT) */
import { useState, type ReactNode } from 'react'
import { useStore } from './store'
import {
  loadSupabaseConfig,
  isSupabaseConfigured,
  getActiveSbId,
  loadSbProfiles,
  getActiveVercelId,
  loadVercelProfiles,
} from './supabase'

type CardStatus = 'connected' | 'partial' | 'disconnected'

function StatusDot({ status }: { status: CardStatus }) {
  const color = status === 'connected' ? '#22c55e' : status === 'partial' ? '#eab308' : '#64748b'
  const label = status === 'connected' ? 'Terhubung' : status === 'partial' ? 'Sebagian' : 'Belum'
  return (
    <span className="conn-status" style={{ color }}>
      <span className="conn-dot" style={{ background: color }} />
      {label}
    </span>
  )
}

function ConnectorCard({
  icon,
  title,
  description,
  status,
  detail,
  children,
  expanded,
  onToggle,
}: {
  icon: string
  title: string
  description: string
  status: CardStatus
  detail?: string
  children?: ReactNode
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className={`conn-card ${status} ${expanded ? 'open' : ''}`}>
      <button type="button" className="conn-card-head" onClick={onToggle}>
        <span className="conn-icon">{icon}</span>
        <span className="conn-meta">
          <span className="conn-title">{title}</span>
          <span className="conn-desc">{description}</span>
          {detail && <span className="conn-detail">{detail}</span>}
        </span>
        <StatusDot status={status} />
        <span className="conn-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && children && <div className="conn-card-body">{children}</div>}
    </div>
  )
}

export function ConnectorsPanel() {
  const {
    github,
    setGithub,
    connectWithToken,
    isLoadingRepos,
    config,
    setConfig,
    connectors,
    setConnectors,
    connectGmail,
    addMessage,
    saveToBackend,
  } = useStore()

  const [openId, setOpenId] = useState<string | null>(null)
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id))

  const sbOk = isSupabaseConfigured()
  const sbActive = getActiveSbId()
  const sbLabel = loadSbProfiles().find((p) => p.id === sbActive)?.label
  const vbActive = getActiveVercelId()
  const vbLabel = loadVercelProfiles().find((p) => p.id === vbActive)?.label
  const vercelOk = Boolean(config.vercelToken?.trim())
  const gmailOk = Boolean(connectors.gmailAccessToken?.trim())
  const tgOk = Boolean(connectors.telegramBotToken?.trim() && connectors.telegramChatId?.trim())
  const slackOk = Boolean(connectors.slackWebhookUrl?.trim())
  const discordOk = Boolean(connectors.discordWebhookUrl?.trim())
  const hookOk = Boolean(connectors.genericWebhookUrl?.trim())

  const openPopup = (url: string) => {
    try {
      window.open(url, 'vo_connect', 'popup=yes,width=640,height=720')
    } catch {
      window.open(url, '_blank')
    }
  }

  return (
    <section className="side-block connectors-panel">
      <h3>Connectors</h3>
      <p className="help-text">Hubungkan layanan seperti di Grok / ChatGPT. Klik kartu untuk atur.</p>

      <div className="conn-grid">
        <ConnectorCard
          icon="🐙"
          title="GitHub"
          description="Repo, push, hapus file"
          status={github.connected && github.token ? 'connected' : github.token ? 'partial' : 'disconnected'}
          detail={github.connected ? `@${github.username}` : undefined}
          expanded={openId === 'github'}
          onToggle={() => toggle('github')}
        >
          <label className="field-label">Personal Access Token</label>
          <input type="password" value={github.token} onChange={(e) => setGithub({ token: e.target.value })} placeholder="ghp_... atau github_pat_..." />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-ghost" onClick={() => openPopup('https://github.com/settings/tokens')}>Buat token</button>
            <button type="button" className="btn-primary" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
              try { await connectWithToken(); saveToBackend({ includeGithubToken: true }).catch(() => {}) }
              catch (e: unknown) { addMessage('System', String(e)) }
            }}>{isLoadingRepos ? '...' : github.connected ? 'Refresh' : 'Hubungkan'}</button>
            {github.connected && (
              <button type="button" className="btn-ghost" onClick={() => {
                setGithub({ token: '', connected: false, username: '', repoFullName: '', owner: '', repo: '' })
                addMessage('System', 'GitHub diputuskan.')
              }}>Putuskan</button>
            )}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="▲"
          title="Vercel"
          description="Deploy online"
          status={vercelOk ? 'connected' : 'disconnected'}
          detail={vbLabel || (vercelOk ? 'Token tersimpan' : undefined)}
          expanded={openId === 'vercel'}
          onToggle={() => toggle('vercel')}
        >
          <p className="help-text">Kelola profil lengkap di bagian Vercel di atas, atau tempel token di sini.</p>
          <label className="field-label">Token</label>
          <input type="password" value={config.vercelToken || ''} onChange={(e) => setConfig({ vercelToken: e.target.value })} placeholder="Token dari vercel.com/account/tokens" />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-ghost" onClick={() => openPopup('https://vercel.com/account/tokens')}>Buat token</button>
            <button type="button" className="btn-primary" disabled={!config.vercelToken?.trim()} onClick={() => {
              addMessage('System', 'Vercel token tersimpan. Pakai perintah deploy di chat.')
              saveToBackend({ includeGithubToken: true }).catch(() => {})
            }}>Simpan</button>
            {vercelOk && <button type="button" className="btn-ghost" onClick={() => setConfig({ vercelToken: '' })}>Putuskan</button>}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="⚡"
          title="Supabase"
          description="Database & sync multi-device"
          status={sbOk ? 'connected' : 'disconnected'}
          detail={sbLabel || (sbOk ? loadSupabaseConfig().url.replace(/^https?:\/\//, '').slice(0, 28) : undefined)}
          expanded={openId === 'supabase'}
          onToggle={() => toggle('supabase')}
        >
          <p className="help-text">Pilih / simpan project di bagian <b>Database Supabase</b> di atas. Tidak ada default otomatis.</p>
          {sbOk ? (
            <p className="help-text" style={{ color: '#22c55e' }}>Aktif: {sbLabel || loadSupabaseConfig().url}</p>
          ) : (
            <p className="help-text">Belum ada project dipilih.</p>
          )}
        </ConnectorCard>

        <ConnectorCard
          icon="📧"
          title="Gmail"
          description="Kirim email via OAuth"
          status={gmailOk ? 'connected' : connectors.gmailClientId ? 'partial' : 'disconnected'}
          detail={connectors.gmailEmail || undefined}
          expanded={openId === 'gmail'}
          onToggle={() => toggle('gmail')}
        >
          <label className="field-label">Google OAuth Client ID</label>
          <input type="text" value={connectors.gmailClientId} onChange={(e) => setConnectors({ gmailClientId: e.target.value })} placeholder="xxxx.apps.googleusercontent.com" />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-ghost" onClick={() => openPopup('https://console.cloud.google.com/apis/credentials')}>Google Console</button>
            <button type="button" className="btn-primary" disabled={!connectors.gmailClientId.trim()} onClick={async () => {
              try { await connectGmail() } catch (e: unknown) { addMessage('System', String(e)) }
            }}>{gmailOk ? 'Hubungkan ulang' : 'Hubungkan'}</button>
            {gmailOk && (
              <button type="button" className="btn-ghost" onClick={() => {
                setConnectors({ gmailAccessToken: '', gmailRefreshToken: '', gmailEmail: '', gmailExpiresAt: 0 })
                addMessage('System', 'Gmail diputuskan.')
              }}>Putuskan</button>
            )}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="✈️"
          title="Telegram"
          description="Kirim notifikasi bot"
          status={tgOk ? 'connected' : connectors.telegramBotToken ? 'partial' : 'disconnected'}
          detail={tgOk ? `chat ${connectors.telegramChatId}` : undefined}
          expanded={openId === 'telegram'}
          onToggle={() => toggle('telegram')}
        >
          <label className="field-label">Bot token</label>
          <input type="password" value={connectors.telegramBotToken} onChange={(e) => setConnectors({ telegramBotToken: e.target.value })} placeholder="123456:ABC..." />
          <label className="field-label">Chat ID</label>
          <input type="text" value={connectors.telegramChatId} onChange={(e) => setConnectors({ telegramChatId: e.target.value })} placeholder="-100... atau user id" />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-ghost" onClick={() => openPopup('https://t.me/BotFather')}>@BotFather</button>
            <button type="button" className="btn-primary" disabled={!connectors.telegramBotToken.trim()} onClick={() => {
              addMessage('System', tgOk ? 'Telegram siap.' : 'Isi Bot token + Chat ID.')
              saveToBackend({ includeGithubToken: true }).catch(() => {})
            }}>Simpan</button>
            {(connectors.telegramBotToken || connectors.telegramChatId) && (
              <button type="button" className="btn-ghost" onClick={() => setConnectors({ telegramBotToken: '', telegramChatId: '' })}>Putuskan</button>
            )}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="💬"
          title="Slack"
          description="Webhook channel"
          status={slackOk ? 'connected' : 'disconnected'}
          expanded={openId === 'slack'}
          onToggle={() => toggle('slack')}
        >
          <label className="field-label">Incoming Webhook URL</label>
          <input type="password" value={connectors.slackWebhookUrl} onChange={(e) => setConnectors({ slackWebhookUrl: e.target.value })} placeholder="https://hooks.slack.com/services/..." />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-primary" disabled={!connectors.slackWebhookUrl.trim()} onClick={() => {
              addMessage('System', 'Slack webhook disimpan.')
              saveToBackend({ includeGithubToken: true }).catch(() => {})
            }}>Simpan</button>
            {slackOk && <button type="button" className="btn-ghost" onClick={() => setConnectors({ slackWebhookUrl: '' })}>Putuskan</button>}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="🎮"
          title="Discord"
          description="Webhook channel"
          status={discordOk ? 'connected' : 'disconnected'}
          expanded={openId === 'discord'}
          onToggle={() => toggle('discord')}
        >
          <label className="field-label">Webhook URL</label>
          <input type="password" value={connectors.discordWebhookUrl} onChange={(e) => setConnectors({ discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-primary" disabled={!connectors.discordWebhookUrl.trim()} onClick={() => {
              addMessage('System', 'Discord webhook disimpan.')
              saveToBackend({ includeGithubToken: true }).catch(() => {})
            }}>Simpan</button>
            {discordOk && <button type="button" className="btn-ghost" onClick={() => setConnectors({ discordWebhookUrl: '' })}>Putuskan</button>}
          </div>
        </ConnectorCard>

        <ConnectorCard
          icon="🔗"
          title="Webhook"
          description="URL generik (n8n, Make, …)"
          status={hookOk ? 'connected' : 'disconnected'}
          expanded={openId === 'webhook'}
          onToggle={() => toggle('webhook')}
        >
          <label className="field-label">URL</label>
          <input type="password" value={connectors.genericWebhookUrl} onChange={(e) => setConnectors({ genericWebhookUrl: e.target.value })} placeholder="https://..." />
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button type="button" className="btn-primary" disabled={!connectors.genericWebhookUrl.trim()} onClick={() => {
              addMessage('System', 'Webhook disimpan.')
              saveToBackend({ includeGithubToken: true }).catch(() => {})
            }}>Simpan</button>
            {hookOk && <button type="button" className="btn-ghost" onClick={() => setConnectors({ genericWebhookUrl: '' })}>Putuskan</button>}
          </div>
        </ConnectorCard>
      </div>
    </section>
  )
}
