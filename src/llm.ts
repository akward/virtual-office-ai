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
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
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
        max_tokens: Math.min(maxTokens, 2500),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.choices?.[0]?.message?.content?.trim() || 'Tidak ada respons.'
    }
    const err = await res.text()
    lastErr = err.slice(0, 250)
    if (res.status === 429) {
      const wait = parseRetryMs(err, attempt)
      if (attempt < maxAttempts - 1) {
        await sleep(wait)
        continue
      }
      throw new Error(`Rate limit. Sudah dicoba ${maxAttempts}x. Detail: ${lastErr}`)
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
  return `output-${agentId}-${i}.${langToExt(lang)}`
}

export type ExtractedArtifact = {
  filename: string
  language: string
  content: string
  action: 'upsert' | 'delete'
}

function isSaneFilename(name: string): boolean {
  const n = name.replace(/^\/+/, '').trim()
  if (!n || n.length > 120) return false
  if (/\s{2,}/.test(n)) return false
  if (/JANGAN|penjelasan|Max \d|Kamu |Here's a thinking|thinking process|```/i.test(n)) return false
  if (!/^[a-zA-Z0-9_./@+-]+$/.test(n)) return false
  if (!/\.[a-zA-Z0-9]{1,12}$/.test(n) && !n.includes('/')) return false
  return true
}

export function sanitizeAgentChat(text: string): string {
  let t = text || ''
  t = t.replace(/```[\s\S]*?```/g, ' ')
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
    if (action === 'upsert' && /JANGAN penjelasan|Max 5 baris|Here's a thinking process|Kamu Budi/i.test(content.slice(0, 400))) {
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
  gemini: {
    name: '1. Google AI Studio (default)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    help: 'Gratis · aistudio.google.com/apikey · model: gemini-3.8-flash',
  },
  groq: {
    name: '2. Groq (cepat)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
    help: 'Gratis · console.groq.com/keys',
  },
  openrouter: {
    name: '3. OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openrouter/free', 'google/gemini-2.0-flash-exp:free', 'openai/gpt-oss-120b:free'],
    help: 'Gratis · openrouter.ai/keys · model :free',
  },
  custom: {
    name: '4. Custom',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini'],
    help: 'Base URL & model sendiri',
  },
} as const

export const SETUP_PRESETS = {
  gemini: {
    name: 'Google AI Studio (disarankan gratis)',
    primary: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash',
    },
    secondary: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
    },
    help: 'Key: aistudio.google.com/apikey · Model utama: gemini-3.8-flash',
  },
  groq: {
    name: 'Groq (cepat)',
    primary: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
    },
    secondary: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash',
    },
    help: 'Key: console.groq.com/keys',
  },
  openrouter: {
    name: 'OpenRouter (banyak model free)',
    primary: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
    },
    secondary: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
    },
    help: 'Key: openrouter.ai/keys · model harus :free',
  },
} as const

export type SetupPresetId = keyof typeof SETUP_PRESETS

export function detectProviderFromBaseUrl(baseUrl: string): keyof typeof PROVIDERS {
  const u = (baseUrl || '').toLowerCase()
  if (u.includes('generativelanguage.googleapis.com')) return 'gemini'
  if (u.includes('openrouter.ai')) return 'openrouter'
  if (u.includes('groq.com')) return 'groq'
  return 'custom'
}

export async function callLLMMulti(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000
): Promise<{ text: string; used: string }> {
  const chain: { label: string; cfg: AppConfig }[] = [
    { label: config.model || 'primary', cfg: config },
  ]
  if (config.apiKey2 && config.baseUrl2 && config.model2) {
    chain.push({
      label: config.model2 + ' (#2)',
      cfg: { ...config, apiKey: config.apiKey2, baseUrl: config.baseUrl2, model: config.model2 },
    })
  }
  for (const extra of config.extraKeys || []) {
    if (extra.apiKey?.trim() && extra.baseUrl?.trim() && extra.model?.trim()) {
      chain.push({
        label: (extra.label || extra.model) + ' (extra)',
        cfg: { ...config, apiKey: extra.apiKey, baseUrl: extra.baseUrl, model: extra.model },
      })
    }
  }
  let lastErr: unknown = null
  for (const item of chain) {
    try {
      const text = await callLLM(item.cfg, systemPrompt, userMessage, maxTokens)
      return { text, used: item.label }
    } catch (e: unknown) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Semua API key gagal'))
}

export async function callLLMEnsemble(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1200
): Promise<{ text: string; used: string }> {
  if (!config.apiKey2 || !config.model2) return callLLMMulti(config, systemPrompt, userMessage, maxTokens)
  const alt: AppConfig = {
    ...config,
    apiKey: config.apiKey2,
    baseUrl: config.baseUrl2 || config.baseUrl,
    model: config.model2,
  }
  const [a, b] = await Promise.allSettled([
    callLLM(config, systemPrompt, userMessage, maxTokens),
    callLLM(alt, systemPrompt + '\nBeri sudut pandang alternatif.', userMessage, maxTokens),
  ])
  const parts: string[] = []
  const used: string[] = []
  if (a.status === 'fulfilled') {
    parts.push(`### Model ${config.model}\n${a.value}`)
    used.push(config.model)
  }
  if (b.status === 'fulfilled') {
    parts.push(`### Model ${config.model2}\n${b.value}`)
    used.push(config.model2)
  }
  if (!parts.length) {
    const err = a.status === 'rejected' ? a.reason : b.status === 'rejected' ? b.reason : 'unknown'
    throw err instanceof Error ? err : new Error(String(err))
  }
  if (parts.length === 1) {
    return {
      text: a.status === 'fulfilled' ? a.value : (b as PromiseFulfilledResult<string>).value,
      used: used.join('+'),
    }
  }
  try {
    const merged = await callLLM(
      config,
      'Gabungkan dua pendapat menjadi satu rencana terbaik, Bahasa Indonesia.',
      parts.join('\n\n').slice(0, 6000),
      1400
    )
    return { text: merged, used: used.join('+merge') }
  } catch {
    return { text: parts.join('\n\n'), used: used.join('+') }
  }
}
