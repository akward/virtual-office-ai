/** External connectors: Gmail (OAuth PKCE), Telegram, Slack/Discord, Neon, Notion, Cloudflare, webhooks */

export type ConnectorId = 'gmail' | 'telegram' | 'slack' | 'discord' | 'webhook' | 'neon' | 'notion' | 'cloudflare'

export interface ConnectorConfig {
  gmailClientId: string
  gmailAccessToken: string
  gmailRefreshToken: string
  gmailEmail: string
  gmailExpiresAt: number
  telegramBotToken: string
  telegramChatId: string
  slackWebhookUrl: string
  discordWebhookUrl: string
  genericWebhookUrl: string
  neonApiKey: string
  neonConnectionString: string
  notionToken: string
  cloudflareToken: string
  cloudflareAccountId: string
}

export const defaultConnectors = (): ConnectorConfig => {
  if (typeof localStorage === 'undefined') {
    return {
      gmailClientId: '',
      gmailAccessToken: '',
      gmailRefreshToken: '',
      gmailEmail: '',
      gmailExpiresAt: 0,
      telegramBotToken: '',
      telegramChatId: '',
      slackWebhookUrl: '',
      discordWebhookUrl: '',
      genericWebhookUrl: '',
      neonApiKey: '',
      neonConnectionString: '',
      notionToken: '',
      cloudflareToken: '',
      cloudflareAccountId: '',
    }
  }
  return {
    gmailClientId: localStorage.getItem('vo_gmail_client_id') || '',
    gmailAccessToken: localStorage.getItem('vo_gmail_access') || '',
    gmailRefreshToken: localStorage.getItem('vo_gmail_refresh') || '',
    gmailEmail: localStorage.getItem('vo_gmail_email') || '',
    gmailExpiresAt: Number(localStorage.getItem('vo_gmail_exp') || 0),
    telegramBotToken: localStorage.getItem('vo_tg_token') || '',
    telegramChatId: localStorage.getItem('vo_tg_chat') || '',
    slackWebhookUrl: localStorage.getItem('vo_slack_wh') || '',
    discordWebhookUrl: localStorage.getItem('vo_discord_wh') || '',
    genericWebhookUrl: localStorage.getItem('vo_generic_wh') || '',
    neonApiKey: localStorage.getItem('vo_neon_key') || '',
    neonConnectionString: localStorage.getItem('vo_neon_cs') || '',
    notionToken: localStorage.getItem('vo_notion_token') || '',
    cloudflareToken: localStorage.getItem('vo_cf_token') || '',
    cloudflareAccountId: localStorage.getItem('vo_cf_account') || '',
  }
}

export function saveConnectors(c: Partial<ConnectorConfig>) {
  if (typeof localStorage === 'undefined') return
  const map: Record<string, keyof ConnectorConfig> = {
    vo_gmail_client_id: 'gmailClientId',
    vo_gmail_access: 'gmailAccessToken',
    vo_gmail_refresh: 'gmailRefreshToken',
    vo_gmail_email: 'gmailEmail',
    vo_gmail_exp: 'gmailExpiresAt',
    vo_tg_token: 'telegramBotToken',
    vo_tg_chat: 'telegramChatId',
    vo_slack_wh: 'slackWebhookUrl',
    vo_discord_wh: 'discordWebhookUrl',
    vo_generic_wh: 'genericWebhookUrl',
    vo_neon_key: 'neonApiKey',
    vo_neon_cs: 'neonConnectionString',
    vo_notion_token: 'notionToken',
    vo_cf_token: 'cloudflareToken',
    vo_cf_account: 'cloudflareAccountId',
  }
  for (const [lsKey, field] of Object.entries(map)) {
    if (c[field] !== undefined) {
      localStorage.setItem(lsKey, String(c[field] ?? ''))
    }
  }
}

function randomString(len = 64) {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Base64Url(input: string) {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hash)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function startGmailOAuth(clientId: string): Promise<void> {
  if (!clientId.trim()) throw new Error('Isi Google OAuth Client ID dulu')
  const verifier = randomString(64)
  const challenge = await sha256Base64Url(verifier)
  const state = randomString(16)
  sessionStorage.setItem('vo_pkce_verifier', verifier)
  sessionStorage.setItem('vo_oauth_state', state)
  sessionStorage.setItem('vo_gmail_client_id', clientId.trim())

  const redirectUri = window.location.origin + window.location.pathname
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function handleGmailOAuthCallback(): Promise<Partial<ConnectorConfig> | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code) return null

  const savedState = sessionStorage.getItem('vo_oauth_state')
  const verifier = sessionStorage.getItem('vo_pkce_verifier')
  const clientId = sessionStorage.getItem('vo_gmail_client_id') || ''
  if (!verifier || !clientId) throw new Error('Sesi OAuth hilang — ulangi Hubungkan Gmail')
  if (state && savedState && state !== savedState) throw new Error('State OAuth tidak cocok')

  const redirectUri = window.location.origin + window.location.pathname
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange gagal')

  window.history.replaceState({}, '', window.location.pathname)

  let email = ''
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    if (ui.ok) {
      const j = await ui.json()
      email = j.email || ''
    }
  } catch {
    /* optional */
  }

  return {
    gmailClientId: clientId,
    gmailAccessToken: data.access_token || '',
    gmailRefreshToken: data.refresh_token || '',
    gmailEmail: email,
    gmailExpiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

async function refreshGmailToken(c: ConnectorConfig): Promise<Partial<ConnectorConfig>> {
  if (!c.gmailRefreshToken || !c.gmailClientId) throw new Error('Tidak ada refresh token Gmail')
  const body = new URLSearchParams({
    client_id: c.gmailClientId,
    refresh_token: c.gmailRefreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || 'Refresh Gmail gagal')
  return {
    gmailAccessToken: data.access_token,
    gmailExpiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

export async function ensureGmailToken(c: ConnectorConfig): Promise<string> {
  if (!c.gmailAccessToken) throw new Error('Gmail belum terhubung')
  if (c.gmailExpiresAt && Date.now() < c.gmailExpiresAt - 60_000) return c.gmailAccessToken
  if (!c.gmailRefreshToken) return c.gmailAccessToken
  const next = await refreshGmailToken(c)
  saveConnectors(next)
  return next.gmailAccessToken || c.gmailAccessToken
}

function toBase64Url(str: string) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function sendGmail(
  c: ConnectorConfig,
  opts: { to: string; subject: string; body: string }
): Promise<void> {
  const token = await ensureGmailToken(c)
  const raw = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ].join('\r\n')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Gmail send ${res.status}: ${t.slice(0, 200)}`)
  }
}

export async function sendTelegram(c: ConnectorConfig, text: string): Promise<void> {
  if (!c.telegramBotToken || !c.telegramChatId) throw new Error('Telegram belum diisi (bot token + chat id)')
  const url = `https://api.telegram.org/bot${c.telegramBotToken}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.telegramChatId, text: text.slice(0, 4000) }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Telegram ${res.status}: ${t.slice(0, 150)}`)
  }
}

export async function sendWebhook(url: string, payload: object): Promise<void> {
  if (!url.trim()) throw new Error('Webhook URL kosong')
  const res = await fetch(url.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Webhook ${res.status}: ${t.slice(0, 150)}`)
  }
}

export function connectorsStatus(c: ConnectorConfig): string {
  const lines: string[] = []
  if (c.gmailAccessToken) lines.push(`Gmail: terhubung${c.gmailEmail ? ` (${c.gmailEmail})` : ''}`)
  else lines.push('Gmail: belum')
  if (c.telegramBotToken && c.telegramChatId) lines.push('Telegram: terhubung')
  else lines.push('Telegram: belum')
  if (c.slackWebhookUrl) lines.push('Slack: terhubung')
  if (c.discordWebhookUrl) lines.push('Discord: terhubung')
  if (c.genericWebhookUrl) lines.push('Webhook: terhubung')
  if (c.neonApiKey || c.neonConnectionString) lines.push('Neon: terhubung')
  if (c.notionToken) lines.push('Notion: terhubung')
  if (c.cloudflareToken) lines.push('Cloudflare: terhubung')
  return lines.join(' | ')
}

export function parseConnectorActions(text: string): {
  emails: { to: string; subject: string; body: string }[]
  telegrams: string[]
  webhooks: { channel: 'slack' | 'discord' | 'generic'; text: string }[]
} {
  const emails: { to: string; subject: string; body: string }[] = []
  const telegrams: string[] = []
  const webhooks: { channel: 'slack' | 'discord' | 'generic'; text: string }[] = []

  const emailRe2 = /SEND_EMAIL\s*:\s*(\S+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/gim
  let m
  while ((m = emailRe2.exec(text)) !== null) {
    emails.push({ to: m[1].trim(), subject: m[2].trim(), body: m[3].trim() })
  }

  const tgRe = /SEND_TELEGRAM\s*:\s*(.+)$/gim
  while ((m = tgRe.exec(text)) !== null) telegrams.push(m[1].trim())

  const whRe = /SEND_(SLACK|DISCORD|WEBHOOK)\s*:\s*(.+)$/gim
  while ((m = whRe.exec(text)) !== null) {
    const ch = m[1].toLowerCase() as 'slack' | 'discord' | 'webhook'
    webhooks.push({
      channel: ch === 'webhook' ? 'generic' : ch,
      text: m[2].trim(),
    })
  }

  return { emails, telegrams, webhooks }
}

export async function executeConnectorActions(
  c: ConnectorConfig,
  text: string
): Promise<string[]> {
  const { emails, telegrams, webhooks } = parseConnectorActions(text)
  const logs: string[] = []

  for (const e of emails) {
    try {
      await sendGmail(c, e)
      logs.push(`Email terkirim ke ${e.to}`)
    } catch (err: unknown) {
      logs.push(`Email gagal (${e.to}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const t of telegrams) {
    try {
      await sendTelegram(c, t)
      logs.push('Telegram terkirim')
    } catch (err: unknown) {
      logs.push(`Telegram gagal: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const w of webhooks) {
    try {
      const url =
        w.channel === 'slack'
          ? c.slackWebhookUrl
          : w.channel === 'discord'
            ? c.discordWebhookUrl
            : c.genericWebhookUrl
      await sendWebhook(url, w.channel === 'discord' ? { content: w.text } : { text: w.text })
      logs.push(`${w.channel} webhook terkirim`)
    } catch (err: unknown) {
      logs.push(`${w.channel} gagal: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return logs
}
