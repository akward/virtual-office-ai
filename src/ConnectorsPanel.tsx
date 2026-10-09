/** Panel Connectors — sederhana seperti Grok / ChatGPT */
import { useState, type ReactNode } from 'react'
import { useStore } from './store'
import {
  loadSupabaseConfig,
  isSupabaseConfigured,
  getActiveSbId,
  loadSbProfiles,
  getActiveVercelId,
  loadVercelProfiles,
  upsertSbProfile,
  selectSbProfile,
} from './supabase'

type CardStatus = 'connected' | 'partial' | 'disconnected'

function StatusPill({ status }: { status: CardStatus }) {
  const map = {
    connected: { c: '#22c55e', t: 'Connected' },
    partial: { c: '#eab308', t: 'Setup' },
    disconnected: { c: '#64748b', t: 'Off' },
  }[status]
  return (
    <span className="conn-pill" style={{ color: map.c, borderColor: map.c + '55' }}>
      <span className="conn-dot" style={{ background: map.c }} />
      {map.t}
    </span>
  )
}

function Card({
  icon, title, subtitle, status, open, onToggle, children,
}: {
  icon: string; title: string; subtitle: string; status: CardStatus
  open: boolean; onToggle: () => void; children?: ReactNode
}) {
  return (
    <div className={`conn-card ${status}${open ? ' open' : ''}`}>
      <button type="button" className="conn-card-head" onClick={onToggle}>
        <span className="conn-icon">{icon}</span>
        <span className="conn-meta">
          <span className="conn-title">{title}</span>
          <span className="conn-desc">{subtitle}</span>
        </span>
        <StatusPill status={status} />
      </button>
      {open && children && <div className="conn-card-body">{children}</div>}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, password }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; password?: boolean
}) {
  return (
    <>
      <label className="field-label">{label}</label>
      <input type={password ? 'password' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </>
  )
}

export function ConnectorsPanel() {
  const {
    github, setGithub, connectWithToken, isLoadingRepos,
    config, setConfig, connectors, setConnectors, connectGmail,
    addMessage, saveToBackend,
  } = useStore()

  const [openId, setOpenId] = useState<string | null>(null)
  const toggle = (id: string) => setOpenId((c) => (c === id ? null : id))
  const [sbUrl, setSbUrl] = useState(() => loadSupabaseConfig().url || '')
  const [sbKey, setSbKey] = useState(() => loadSupabaseConfig().anonKey || '')
  const [sbName, setSbName] = useState('')

  const popup = (url: string) => {
    try { window.open(url, 'vo_connect', 'popup=yes,width=640,height=720') }
    catch { window.open(url, '_blank') }
  }
  const saveCloud = () => saveToBackend({ includeGithubToken: true }).catch(() => {})

  // Token dari cloud = Connected (tidak wajib klik Connect lagi)
  const ghOk = Boolean(github.token?.trim() && (github.connected || github.username))
  const vercelOk = Boolean(config.vercelToken?.trim())
  const sbOk = isSupabaseConfigured()
  const gmailOk = Boolean(connectors.gmailAccessToken)
  const tgOk = Boolean(connectors.telegramBotToken && connectors.telegramChatId)
  const neonOk = Boolean(connectors.neonApiKey || connectors.neonConnectionString)
  const notionOk = Boolean(connectors.notionToken)
  const cfOk = Boolean(connectors.cloudflareToken)
  const slackOk = Boolean(connectors.slackWebhookUrl)
  const discordOk = Boolean(connectors.discordWebhookUrl)
  const hookOk = Boolean(connectors.genericWebhookUrl)

  const sbLabel = loadSbProfiles().find((p) => p.id === getActiveSbId())?.label
  const vbLabel = loadVercelProfiles().find((p) => p.id === getActiveVercelId())?.label

  return (
    <div className="conn-grid">
      <Card icon="🐙" title="GitHub" subtitle={ghOk ? `@${github.username}` : 'Repos & code'} status={ghOk ? 'connected' : github.token ? 'partial' : 'disconnected'} open={openId === 'github'} onToggle={() => toggle('github')}>
        <Field label="Token" value={github.token} onChange={(v) => setGithub({ token: v })} placeholder="ghp_..." password />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://github.com/settings/tokens')}>Get token</button>
          <button type="button" className="btn-primary" disabled={isLoadingRepos || !github.token.trim()} onClick={async () => {
            try { await connectWithToken(); saveCloud() } catch (e: unknown) { addMessage('System', String(e)) }
          }}>{isLoadingRepos ? '...' : 'Connect'}</button>
        </div>
      </Card>

      <Card icon="▲" title="Vercel" subtitle={vbLabel || (vercelOk ? 'Deploy ready' : 'Deploy apps')} status={vercelOk ? 'connected' : 'disconnected'} open={openId === 'vercel'} onToggle={() => toggle('vercel')}>
        <Field label="Token" value={config.vercelToken || ''} onChange={(v) => setConfig({ vercelToken: v })} placeholder="vercel token" password />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://vercel.com/account/tokens')}>Get token</button>
          <button type="button" className="btn-primary" disabled={!config.vercelToken?.trim()} onClick={() => { addMessage('System', 'Vercel connected.'); saveCloud() }}>Save</button>
        </div>
      </Card>

      <Card icon="⚡" title="Supabase" subtitle={sbLabel || (sbOk ? 'Database' : 'Postgres / auth')} status={sbOk ? 'connected' : 'disconnected'} open={openId === 'supabase'} onToggle={() => toggle('supabase')}>
        <Field label="Project name" value={sbName} onChange={setSbName} placeholder="my-project" />
        <Field label="URL" value={sbUrl} onChange={setSbUrl} placeholder="https://xxxx.supabase.co" />
        <Field label="Anon key" value={sbKey} onChange={setSbKey} placeholder="eyJ... or sb_publishable_..." password />
        <div className="row-actions">
          <button type="button" className="btn-primary" disabled={!sbUrl.trim() || !sbKey.trim()} onClick={() => {
            const id = getActiveSbId() || crypto.randomUUID()
            const label = sbName.trim() || sbUrl.replace(/^https?:\/\//, '').split('.')[0]
            upsertSbProfile({ id, label, url: sbUrl.replace(/\/$/, ''), anonKey: sbKey.trim() })
            selectSbProfile(id)
            addMessage('System', `Supabase «${label}» active.`)
            saveCloud()
          }}>Connect</button>
        </div>
      </Card>

      <Card icon="🟢" title="Neon" subtitle={neonOk ? 'Postgres ready' : 'Serverless Postgres'} status={neonOk ? 'connected' : 'disconnected'} open={openId === 'neon'} onToggle={() => toggle('neon')}>
        <Field label="API key" value={connectors.neonApiKey || ''} onChange={(v) => setConnectors({ neonApiKey: v })} placeholder="napi_..." password />
        <Field label="Connection string" value={connectors.neonConnectionString || ''} onChange={(v) => setConnectors({ neonConnectionString: v })} placeholder="postgresql://..." password />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://console.neon.tech')}>Neon console</button>
          <button type="button" className="btn-primary" disabled={!connectors.neonApiKey && !connectors.neonConnectionString} onClick={() => { addMessage('System', 'Neon connected.'); saveCloud() }}>Save</button>
        </div>
      </Card>

      <Card icon="📧" title="Gmail" subtitle={connectors.gmailEmail || 'Send email'} status={gmailOk ? 'connected' : connectors.gmailClientId ? 'partial' : 'disconnected'} open={openId === 'gmail'} onToggle={() => toggle('gmail')}>
        <Field label="OAuth Client ID" value={connectors.gmailClientId} onChange={(v) => setConnectors({ gmailClientId: v })} placeholder="....apps.googleusercontent.com" />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://console.cloud.google.com/apis/credentials')}>Google Console</button>
          <button type="button" className="btn-primary" disabled={!connectors.gmailClientId.trim()} onClick={async () => {
            try { await connectGmail() } catch (e: unknown) { addMessage('System', String(e)) }
          }}>{gmailOk ? 'Reconnect' : 'Connect'}</button>
        </div>
      </Card>

      <Card icon="✈️" title="Telegram" subtitle={tgOk ? 'Bot ready' : 'Notifications'} status={tgOk ? 'connected' : connectors.telegramBotToken ? 'partial' : 'disconnected'} open={openId === 'telegram'} onToggle={() => toggle('telegram')}>
        <Field label="Bot token" value={connectors.telegramBotToken} onChange={(v) => setConnectors({ telegramBotToken: v })} placeholder="123456:ABC..." password />
        <Field label="Chat ID" value={connectors.telegramChatId} onChange={(v) => setConnectors({ telegramChatId: v })} placeholder="-100..." />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://t.me/BotFather')}>@BotFather</button>
          <button type="button" className="btn-primary" disabled={!connectors.telegramBotToken} onClick={() => { addMessage('System', tgOk ? 'Telegram ready.' : 'Add Chat ID too.'); saveCloud() }}>Save</button>
        </div>
      </Card>

      <Card icon="📓" title="Notion" subtitle={notionOk ? 'Workspace linked' : 'Pages & databases'} status={notionOk ? 'connected' : 'disconnected'} open={openId === 'notion'} onToggle={() => toggle('notion')}>
        <Field label="Integration token" value={connectors.notionToken || ''} onChange={(v) => setConnectors({ notionToken: v })} placeholder="secret_... or ntn_..." password />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://www.notion.so/my-integrations')}>Create integration</button>
          <button type="button" className="btn-primary" disabled={!connectors.notionToken} onClick={() => { addMessage('System', 'Notion connected.'); saveCloud() }}>Save</button>
        </div>
      </Card>

      <Card icon="☁️" title="Cloudflare" subtitle={cfOk ? 'Account linked' : 'Workers / Pages / R2'} status={cfOk ? 'connected' : 'disconnected'} open={openId === 'cloudflare'} onToggle={() => toggle('cloudflare')}>
        <Field label="API token" value={connectors.cloudflareToken || ''} onChange={(v) => setConnectors({ cloudflareToken: v })} placeholder="CF API token" password />
        <Field label="Account ID" value={connectors.cloudflareAccountId || ''} onChange={(v) => setConnectors({ cloudflareAccountId: v })} placeholder="Account ID" />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={() => popup('https://dash.cloudflare.com/profile/api-tokens')}>API tokens</button>
          <button type="button" className="btn-primary" disabled={!connectors.cloudflareToken} onClick={() => { addMessage('System', 'Cloudflare connected.'); saveCloud() }}>Save</button>
        </div>
      </Card>

      <Card icon="💬" title="Slack" subtitle={slackOk ? 'Webhook on' : 'Channel webhook'} status={slackOk ? 'connected' : 'disconnected'} open={openId === 'slack'} onToggle={() => toggle('slack')}>
        <Field label="Webhook URL" value={connectors.slackWebhookUrl} onChange={(v) => setConnectors({ slackWebhookUrl: v })} placeholder="https://hooks.slack.com/..." password />
        <button type="button" className="btn-primary" disabled={!connectors.slackWebhookUrl.trim()} onClick={() => { addMessage('System', 'Slack connected.'); saveCloud() }}>Save</button>
      </Card>

      <Card icon="🎮" title="Discord" subtitle={discordOk ? 'Webhook on' : 'Channel webhook'} status={discordOk ? 'connected' : 'disconnected'} open={openId === 'discord'} onToggle={() => toggle('discord')}>
        <Field label="Webhook URL" value={connectors.discordWebhookUrl} onChange={(v) => setConnectors({ discordWebhookUrl: v })} placeholder="https://discord.com/api/webhooks/..." password />
        <button type="button" className="btn-primary" disabled={!connectors.discordWebhookUrl.trim()} onClick={() => { addMessage('System', 'Discord connected.'); saveCloud() }}>Save</button>
      </Card>

      <Card icon="🔗" title="Webhook" subtitle={hookOk ? 'Custom URL' : 'n8n, Make, Zapier…'} status={hookOk ? 'connected' : 'disconnected'} open={openId === 'webhook'} onToggle={() => toggle('webhook')}>
        <Field label="URL" value={connectors.genericWebhookUrl} onChange={(v) => setConnectors({ genericWebhookUrl: v })} placeholder="https://..." password />
        <button type="button" className="btn-primary" disabled={!connectors.genericWebhookUrl.trim()} onClick={() => { addMessage('System', 'Webhook connected.'); saveCloud() }}>Save</button>
      </Card>
    </div>
  )
}
