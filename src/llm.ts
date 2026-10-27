import type { AppConfig } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseRetryMs(errBody: string, attempt: number): number {
  const m = errBody.match(/try again in\s+([\d.]+)\s*s/i)
  if (m) return Math.min(90000, Math.ceil(parseFloat(m[1]) * 1000) + 500)
  return Math.min(60000, 15000 * (attempt + 1))
}

export async function callLLM(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000
): Promise<string> {
  if (!config.apiKey) throw new Error('API Key belum diisi. Isi dulu di Settings.')
  const sys = systemPrompt.length > 4000 ? systemPrompt.slice(0, 4000) + '\n…' : systemPrompt
  const usr = userMessage.length > 12000 ? userMessage.slice(0, 12000) + '\n…' : userMessage
  const maxAttempts = 5
  let lastErr = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response
    try {
      const isCf = /api\.cloudflare\.com/i.test(config.baseUrl || '')
      if (isCf) {
        const m = (config.baseUrl || '').match(/\/accounts\/([^/]+)/i)
        const accountId = m?.[1] || ''
        if (!accountId) throw new Error('Cloudflare baseUrl harus berisi /accounts/{ACCOUNT_ID}/ai')
        res = await fetch('/api/cf-ai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            accountId,
            model: config.model,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: usr },
            ],
            temperature: 0.45,
            max_tokens: Math.min(Math.max(maxTokens, 1), 4096),
          }),
        })
      } else {
        res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: usr },
            ],
            temperature: 0.45,
            max_tokens: Math.min(Math.max(maxTokens, 1), 4096),
          }),
        })
      }
    } catch (netErr: unknown) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr)
      throw new Error(msg || 'Failed to fetch')
    }
    if (res.ok) {
      const data = await res.json()
      const msg = data.choices?.[0]?.message || {}
      let content = (msg.content || '').trim()
      // Beberapa model free hanya mengisi reasoning / reasoning_details
      if (!content && typeof msg.reasoning === 'string') content = msg.reasoning.trim()
      if (!content && Array.isArray(msg.reasoning_details)) {
        content = msg.reasoning_details
          .map((d: any) => (typeof d === 'string' ? d : d?.text || d?.content || ''))
          .filter(Boolean)
          .join('\n')
          .trim()
      }
      if (!content && typeof data.choices?.[0]?.text === 'string') content = data.choices[0].text.trim()
      if (!content) {
        lastErr = 'Model mengembalikan konten kosong'
        if (attempt < maxAttempts - 1) {
          await sleep(800 * (attempt + 1))
          continue
        }
        throw new Error('Model tidak mengembalikan teks. Coba model/API key lain.')
      }
      return content
    }
    const err = await res.text()
    lastErr = err.slice(0, 280)
    if (res.status === 402 || /more credits|can only afford|insufficient.*credit/i.test(err)) {
      throw new Error(`LLM Error 402: kredit API habis / tidak cukup. Isi kredit atau ganti provider. ${lastErr}`)
    }
    // 429/503: max 1x retry singkat, lalu lempar agar callLLMMulti ganti provider/model
    if (res.status === 429 || res.status === 503 || /UNAVAILABLE|high demand|overloaded|capacity|rate limit/i.test(err)) {
      if (attempt < 1) {
        await sleep(res.status === 503 ? 1200 : 800)
        continue
      }
      throw new Error(
        res.status === 503
          ? `LLM Error 503: model sibuk. Detail: ${lastErr}`
          : `LLM Error 429: Rate limit. Detail: ${lastErr}`
      )
    }
    if (res.status === 404 || /model_not_found|does not exist|do not have access/i.test(err)) {
      throw new Error(`LLM Error 404: model tidak tersedia. Detail: ${lastErr}`)
    }
    throw new Error(`LLM Error ${res.status}: ${lastErr}`)
  }
  throw new Error(`LLM gagal setelah retry: ${lastErr}`)
}

export async function paceBetweenAgents(ms = 10000): Promise<void> {
  await sleep(ms)
}

function langToExt(lang: string): string {
  const l = lang.toLowerCase()
  if (l === 'javascript' || l === 'js') return 'js'
  if (l === 'typescript' || l === 'ts') return 'ts'
  if (l === 'python' || l === 'py') return 'py'
  if (l === 'html' || l === 'htm') return 'html'
  if (l === 'css') return 'css'
  if (l === 'json') return 'json'
  if (l === 'markdown' || l === 'md') return 'md'
  if (l === 'bash' || l === 'shell' || l === 'sh') return 'sh'
  if (l === 'yaml' || l === 'yml') return 'yml'
  if (l === 'text' || l === 'txt' || !l) return 'txt'
  return l.slice(0, 8)
}

function pathFromContent(content: string): string | null {
  const lines = content.split('\n').slice(0, 8)
  for (const line of lines) {
    const patterns = [
      /(?:^|\s)(?:Path|File|Filename|FILE|PATH)\s*[:=]\s*['"]?([^\s'"`*<>]+)/i,
      /<!--\s*(?:Path|File)\s*[:=]\s*([^\s*->]+)\s*-->/i,
    ]
    for (const re of patterns) {
      const m = line.match(re)
      if (m?.[1]) return m[1].replace(/^["']|["']$/g, '').replace(/^\.\//, '').trim()
    }
  }
  return null
}

function inferFilename(lang: string, content: string, agentId: string, i: number): string {
  const c = content.slice(0, 800).toLowerCase()
  if (c.includes('<!doctype html') || c.includes('<html')) return 'index.html'
  if (lang === 'css') return 'styles.css'
  if (lang === 'js' || lang === 'javascript') return 'app.js'
  if (c.includes('"name"') && c.includes('"dependencies"')) return 'package.json'
  if (lang === 'md' || lang === 'markdown') {
    return agentId === 'researcher' ? 'docs/analysis.md' : agentId === 'security' ? 'docs/security-review.md' : 'README.md'
  }
  return agentId === 'coder' ? `src/snippet-${i}.${langToExt(lang)}` : `docs/note-${agentId}-${i}.${langToExt(lang)}`
}

export type ExtractedArtifact = {
  filename: string
  language: string
  content: string
  action: 'upsert' | 'delete'
}

function isSaneFilename(name: string): boolean {
  const n = name.replace(/^\/+/, '').trim()
  if (!n || n.length > 100) return false
  if (/\s{2,}/.test(n)) return false
  if (/JANGAN|penjelasan|Max \d|Kamu |Here's a thinking|thinking process|```/i.test(n)) return false
  if (/^output[-_]/i.test(n.split('/').pop() || '')) return false
  if (/\.(sh|dotenv)$/i.test(n)) return false
  if (!/^[a-zA-Z0-9_./@+-]+$/.test(n)) return false
  if (!/\.[a-zA-Z0-9]{1,12}$/.test(n) && !n.includes('/')) return false
  return true
}

export function isJunkAgentOutput(text: string): boolean {
  const t = text || ''
  if (/<\|tool_call|tool_call_start|tool_call_end/i.test(t)) return true
  if (/\{\s*"tool"\s*:\s*"(bash|read|write|shell)"/i.test(t)) return true
  if (/\/home\/(gibbon|workdir|user)\//i.test(t)) return true
  if (/synthtraces\/repos/i.test(t)) return true
  if (/^\s*User Safety\s*:/im.test(t) && t.length < 80) return true
  if (/^\s*User Safety\s*:\s*safe\s*$/im.test(t)) return true
  return false
}

export function sanitizeAgentChat(text: string): string {
  let t = text || ''
  if (isJunkAgentOutput(t) && !/```/.test(t)) {
    return ''
  }
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/<\|tool_call[\s\S]*?(?:tool_call_end\|>|$)/gi, ' ')
  t = t.replace(/\{\s*"tool"\s*:[\s\S]*?\}/g, ' ')
  t = t.replace(/User Safety\s*:\s*\w+/gi, ' ')
  t = t.replace(/\/home\/[\w./-]+/g, ' ')
  t = t.replace(/Here's a thinking process:[\s\S]*/gi, ' ')
  t = t.replace(/\*\*Analyze User Input:\*\*[\s\S]*/gi, ' ')
  t = t.replace(/Kamu Budi\. Max 5 baris\.[\s\S]*/gi, ' ')
  t = t.replace(/JANGAN penjelasan panjang[^\n]*/gi, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

export function extractArtifacts(text: string, agentId: string): { cleanText: string; artifacts: ExtractedArtifact[] } {
  const artifacts: ExtractedArtifact[] = []
  const used = new Set<string>()
  let i = 0
  const pushArt = (filename: string, language: string, content: string, action: 'upsert' | 'delete') => {
    let finalName = filename.replace(/^\/+/, '').trim()
    if (!finalName) return
    if (!isSaneFilename(finalName)) return
    if (action === 'upsert' && /JANGAN penjelasan|Max 5 baris|Here's a thinking process|Kamu Budi|tool_call|User Safety|synthtraces|\/home\/gibbon/i.test(content.slice(0, 800))) {
      return
    }
    if (action === 'upsert' && content.trim().length < 40 && !/html|css|js|json|md/i.test(language)) {
      return
    }
    if (action === 'upsert') {
      let n = 2
      let candidate = finalName
      while (used.has(candidate + '::upsert')) {
        const parts = finalName.split('.')
        if (parts.length > 1) {
          const ext = parts.pop()
          candidate = `${parts.join('.')}-${n}.${ext}`
        } else candidate = `${finalName}-${n}`
        n++
      }
      finalName = candidate
      used.add(finalName + '::upsert')
    } else {
      if (used.has(finalName + '::delete')) return
      used.add(finalName + '::delete')
    }
    artifacts.push({ filename: finalName, language, content, action })
  }
  const re = /```([a-zA-Z0-9_+.-]*)(?::([^\n]+))?\n([\s\S]*?)```/g
  let match
  while ((match = re.exec(text)) !== null) {
    let lang = (match[1] || '').toLowerCase()
    let filename = (match[2] || '').trim().replace(/^["']|["']$/g, '').replace(/^\.\//, '')
    let content = match[3].trim()
    if (lang === 'delete' || lang === 'hapus' || lang === 'rm') {
      const path = filename || content.split('\n')[0].trim()
      if (path && isSaneFilename(path)) pushArt(path, 'delete', '', 'delete')
      continue
    }
    if (!content && !filename) continue
    if (!filename) filename = pathFromContent(content) || ''
    if (!filename) filename = inferFilename(lang || 'txt', content, agentId, ++i)
    else i++
    pushArt(filename, lang || 'text', content, 'upsert')
  }
  const lineRe = /^\s*(?:DELETE|HAPUS|REMOVE|RM)\s*[:\-]\s*[`'\"]?([^\s`'\"]+)[`'\"]?\s*$/gim
  let lm
  while ((lm = lineRe.exec(text)) !== null) {
    if (isSaneFilename(lm[1])) pushArt(lm[1], 'delete', '', 'delete')
  }
  return { cleanText: text, artifacts }
}

export const PROVIDERS = {
  xai: {
    name: '0. xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3-mini', 'grok-3', 'grok-2-latest'],
  },
  explabs: {
    name: '1. Experiential Labs (Qwen)',
    baseUrl: 'https://api.experientiallabs.ai/v1',
    models: ['qwen3.8-flash', 'qwen3.8-27b', 'qwen3.6-flash'],
  },
  gemini: {
    name: '2. Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.0-flash'],
  },
  openrouter: {
    name: '3. OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-oss-20b', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  },
  groq: {
    name: '4. Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
  },
  cloudflare: {
    name: '5. Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/f8369ba007b8396cece5617eee728c02/ai',
    models: [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/openai/gpt-oss-20b',
      '@cf/openai/gpt-oss-120b',
    ],
  },
}

export type SetupPresetId = 'xai' | 'explabs' | 'gemini' | 'groq' | 'openrouter' | 'cloudflare'

export const SETUP_PRESETS: Record<
  SetupPresetId,
  { primary: { baseUrl: string; model: string }; secondary: { baseUrl: string; model: string } }
> = {
  xai: {
    primary: { baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
    secondary: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b' },
  },
  explabs: {
    primary: { baseUrl: 'https://api.experientiallabs.ai/v1', model: 'qwen3.8-flash' },
    secondary: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b' },
  },
  gemini: {
    primary: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.0-flash',
    },
    secondary: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.0-flash-001',
    },
  },
  groq: {
    primary: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    },
    secondary: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.3-70b-instruct',
    },
  },
  openrouter: {
    primary: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-oss-20b',
    },
    secondary: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.1-8b-instant',
    },
  },
  cloudflare: {
    primary: {
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/f8369ba007b8396cece5617eee728c02/ai',
      model: '@cf/meta/llama-3.1-8b-instruct',
    },
    secondary: {
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/f8369ba007b8396cece5617eee728c02/ai',
      model: '@cf/openai/gpt-oss-20b',
    },
  },
}

export function detectProviderFromBaseUrl(baseUrl: string): SetupPresetId | 'custom' {
  const b = (baseUrl || '').toLowerCase()
  if (b.includes('api.x.ai') || b.includes('x.ai')) return 'xai'
  if (b.includes('experientiallabs')) return 'explabs'
  if (b.includes('generativelanguage.googleapis') || b.includes('googleapis.com')) return 'gemini'
  if (b.includes('openrouter')) return 'openrouter'
  if (b.includes('groq')) return 'groq'
  if (b.includes('cloudflare.com')) return 'cloudflare'
  return 'custom'
}


export function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, '')
  } catch {
    return (baseUrl || '').toLowerCase()
  }
}

/** Error yang sebaiknya memicu ganti model/provider */
export function shouldRotateProvider(err: string): boolean {
  return /LLM Error (429|402|401|403|404|503)|Rate limit|kredit|credit|quota|insufficient|model_not_found|does not exist|do not have access|invalid.?api.?key|Unauthorized|Failed to fetch|network|UNAVAILABLE|overloaded|capacity|model_requires_purchase|locked on your account/i.test(
    err || ''
  )
}

/** Rantai fallback: kunci utama → model alternatif → kunci cadangan */
export function describeFallbackChain(config: AppConfig): string {
  const parts: string[] = []
  if (config.apiKey) parts.push(`1) ${config.model}@${providerHost(config.baseUrl || '')}`)
  if (config.apiKey2) parts.push(`2) ${(config.model2 || config.model)}@${providerHost(config.baseUrl2 || config.baseUrl || '')}`)
  for (const extra of config.extraKeys || []) {
    if (extra?.apiKey) {
      parts.push(
        `${extra.label || 'extra'}:${extra.model || config.model}@${providerHost(extra.baseUrl || config.baseUrl || '')}`
      )
    }
  }
  return parts.join(' → ') || 'tidak ada API key'
}

export async function callLLMMulti(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000
): Promise<{ text: string; model: string }> {
  type Slot = { apiKey: string; baseUrl: string; model: string; label: string }
  const keys: Slot[] = []
  if (config.apiKey) {
    keys.push({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, label: 'utama' })
  }
  if (config.apiKey2) {
    keys.push({
      apiKey: config.apiKey2,
      baseUrl: config.baseUrl2 || config.baseUrl,
      model: config.model2 || config.model,
      label: 'cadangan',
    })
  }
  for (const extra of config.extraKeys || []) {
    if (extra?.apiKey) {
      keys.push({
        apiKey: extra.apiKey,
        baseUrl: extra.baseUrl || config.baseUrl,
        model: extra.model || config.model,
        label: extra.label || 'extra',
      })
    }
  }
  if (!keys.length) throw new Error('API Key belum diisi')

  const expandModels = (k: Slot): Slot[] => {
    const list: Slot[] = [k]
    const b = (k.baseUrl || '').toLowerCase()
    const alts: string[] = []
    if (b.includes('generativelanguage.googleapis') || b.includes('googleapis.com')) {
      alts.push('gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest')
    } else if (b.includes('openrouter')) {
      alts.push(
        'poolside/laguna-s-2.1:free',
        'openrouter/free',
        'liquid/lfm-2.5-2.6b:free',
        'nvidia/nemotron-3.5-lightning:free',
        'xingchen-agi/xing4.0-29b-a4b:free',
        'poolside/laguna-xs-2.1:free',
        'recursive/flint-v1.0:free'
      )
    } else if (b.includes('groq')) {
      alts.push('llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it')
    } else if (b.includes('api.x.ai') || b.includes('x.ai')) {
      alts.push('grok-3-mini', 'grok-3', 'grok-2-latest')
    } else if (b.includes('experientiallabs')) {
      alts.push('qwen3.8-flash', 'qwen3.8-27b')
    } else if (b.includes('cloudflare.com')) {
      alts.push(
        '@cf/meta/llama-3.1-8b-instruct',
        '@cf/openai/gpt-oss-20b',
        '@cf/meta/llama-3.1-70b-instruct'
      )
    }
    for (const alt of alts) {
      if (alt !== k.model) list.push({ ...k, model: alt })
    }
    return list
  }

  // Interleave: coba model-0 tiap provider dulu, baru alternatif (agar tidak stuck di Cloudflare)
  const expanded = keys.map(expandModels)
  const queue: Slot[] = []
  const maxLen = Math.max(0, ...expanded.map((x) => x.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of expanded) {
      if (i < list.length) queue.push(list[i])
    }
  }

  const seen = new Set<string>()
  const deduped: Slot[] = []
  for (const k of queue) {
    const id = `${providerHost(k.baseUrl)}|${k.model}|${k.apiKey.slice(0, 12)}`
    if (seen.has(id)) continue
    seen.add(id)
    deduped.push(k)
  }

  let lastError = ''
  const skippedHosts = new Set<string>()
  const tried: string[] = []

  for (const k of deduped) {
    const host = providerHost(k.baseUrl)
    if (skippedHosts.has(host)) continue
    const tag = `${k.label}:${k.model}@${host}`
    tried.push(tag)
    try {
      const text = await callLLM(
        { ...config, apiKey: k.apiKey, baseUrl: k.baseUrl, model: k.model },
        systemPrompt,
        userMessage,
        maxTokens
      )
      return { text, model: `${k.model} (${k.label})` }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e)
      // Limit/kuota/key mati di host ini → loncat ke provider lain
      if (
        /LLM Error (429|402|401|403)|Rate limit|kredit|credit|quota|insufficient|invalid.?api.?key|Unauthorized|model_requires_purchase|locked on your account|Failed to fetch/i.test(
          lastError
        )
      ) {
        skippedHosts.add(host)
      }
    }
  }

  throw new Error(
    `Semua provider/model gagal setelah rotasi otomatis.\nDicoba: ${tried.slice(0, 14).join(' → ')}${tried.length > 14 ? '…' : ''}\nTerakhir: ${lastError}`
  )
}
