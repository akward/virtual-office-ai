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
      const content = data.choices?.[0]?.message?.content?.trim() || ''
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
  gemini: {
    name: '1. Google AI Studio (default)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'],
  },
  openrouter: {
    name: '2. OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-oss-20b', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  },
  groq: {
    name: '3. Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
  },
}

export async function callLLMMulti(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000
): Promise<{ text: string; model: string }> {
  const keys: { apiKey: string; baseUrl: string; model: string }[] = []
  if (config.apiKey) keys.push({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model })
  if (config.apiKey2) keys.push({ apiKey: config.apiKey2, baseUrl: config.baseUrl2 || config.baseUrl, model: config.model2 || config.model })
  for (const extra of config.extraKeys || []) {
    if (extra?.apiKey) keys.push({ apiKey: extra.apiKey, baseUrl: extra.baseUrl || config.baseUrl, model: extra.model || config.model })
  }
  if (!keys.length) throw new Error('API Key belum diisi')
  let lastError = ''
  for (const k of keys) {
    try {
      const text = await callLLM({ ...config, apiKey: k.apiKey, baseUrl: k.baseUrl, model: k.model }, systemPrompt, userMessage, maxTokens)
      return { text, model: k.model }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e)
      if (/429|rate limit/i.test(lastError)) continue
      if (/401|403|invalid.*key/i.test(lastError) && keys.length > 1) continue
      if (keys.length === 1) throw e
    }
  }
  throw new Error(lastError || 'Semua API gagal')
}
