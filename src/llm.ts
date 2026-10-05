import type { AppConfig } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseRetryMs(errBody: string, attempt: number): number {
  const m = errBody.match(/try again in\s+([\d.]+)\s*s/i)
  if (m) {
    return Math.min(90000, Math.ceil(parseFloat(m[1]) * 1000) + 500)
  }
  return Math.min(60000, 15000 * (attempt + 1))
}

export async function callLLM(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1200
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('API Key belum diisi. Isi dulu di Settings.')
  }

  const sys = systemPrompt.length > 2500 ? systemPrompt.slice(0, 2500) + '\n…' : systemPrompt
  const usr = userMessage.length > 6000 ? userMessage.slice(0, 6000) + '\n…' : userMessage

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
        temperature: 0.5,
        max_tokens: Math.min(maxTokens, 1500),
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
      throw new Error(
        `Rate limit Groq (TPM). Sudah dicoba ${maxAttempts}x. Tunggu 1–2 menit lalu kirim lagi, atau ganti model ke openai/gpt-oss-20b. Detail: ${lastErr}`
      )
    }

    throw new Error(`LLM Error ${res.status}: ${lastErr}`)
  }

  throw new Error(`LLM gagal setelah retry: ${lastErr}`)
}

export async function paceBetweenAgents(ms = 12000): Promise<void> {
  await sleep(ms)
}

function langToExt(lang: string): string {
  const l = lang.toLowerCase()
  if (l === 'javascript' || l === 'js') return 'js'
  if (l === 'typescript' || l === 'ts') return 'ts'
  if (l === 'tsx') return 'tsx'
  if (l === 'python' || l === 'py') return 'py'
  if (l === 'html' || l === 'htm') return 'html'
  if (l === 'css') return 'css'
  if (l === 'json') return 'json'
  if (l === 'markdown' || l === 'md') return 'md'
  if (l === 'bash' || l === 'shell' || l === 'sh') return 'sh'
  if (l === 'yaml' || l === 'yml') return 'yml'
  if (l === 'xml') return 'xml'
  if (l === 'sql') return 'sql'
  if (l === 'text' || l === 'txt' || !l) return 'txt'
  return l.slice(0, 8)
}

function pathFromContent(content: string): string | null {
  const lines = content.split('\n').slice(0, 8)
  for (const line of lines) {
    const patterns = [
      /(?:^|\s)(?:Path|File|Filename|FILE|PATH)\s*[:=]\s*['"]?([^\s'"`*<>]+)/i,
      /<!--\s*(?:Path|File)\s*[:=]\s*([^\s*->]+)\s*-->/i,
      /\/\/\s*(?:Path|File)\s*[:=]\s*([^\s]+)/i,
      /#\s*(?:Path|File)\s*[:=]\s*([^\s]+)/i,
    ]
    for (const re of patterns) {
      const m = line.match(re)
      if (m?.[1]) {
        return m[1].replace(/^["']|["']$/g, '').replace(/^\.\//, '').trim()
      }
    }
  }
  return null
}

function inferFilename(lang: string, content: string, agentId: string, i: number): string {
  const c = content.slice(0, 800).toLowerCase()
  if (c.includes('<!doctype html') || c.includes('<html')) return 'index.html'
  if (lang === 'css') return 'styles.css'
  if (lang === 'js' || lang === 'javascript') return 'app.js'
  if (lang === 'ts' || lang === 'typescript') return 'app.ts'
  if (c.includes('"name"') && c.includes('"dependencies"')) return 'package.json'
  if (c.startsWith('# ') && (c.includes('readme') || agentId === 'writer')) return 'README.md'
  if (lang === 'md' || lang === 'markdown') {
    return agentId === 'researcher' ? 'docs/analysis.md' : 'README.md'
  }
  if (lang === 'yml' || lang === 'yaml' || c.includes('theme:') || c.includes('jekyll')) return '_config.yml'
  if (lang === 'py' || lang === 'python') return 'main.py'
  return `output-${agentId}-${i}.${langToExt(lang)}`
}

export function extractArtifacts(
  text: string,
  agentId: string
): { cleanText: string; artifacts: { filename: string; language: string; content: string }[] } {
  const artifacts: { filename: string; language: string; content: string }[] = []
  const re = /```([a-zA-Z0-9_+.-]*)(?::([^\n]+))?\n([\s\S]*?)```/g
  let match
  let i = 0
  const used = new Set<string>()

  while ((match = re.exec(text)) !== null) {
    let lang = (match[1] || '').toLowerCase()
    let filename = (match[2] || '').trim().replace(/^["']|["']$/g, '').replace(/^\.\//, '')
    const content = match[3].trim()
    if (!content) continue

    if (
      lang &&
      !filename &&
      /\.[a-z0-9]+$/i.test(lang) &&
      !['html', 'css', 'js', 'ts', 'tsx', 'py', 'md', 'json', 'yml', 'yaml', 'sh', 'bash', 'sql', 'xml', 'txt'].includes(lang)
    ) {
      filename = lang
      const ext = filename.split('.').pop() || 'txt'
      lang = ext
    }

    if (!filename) {
      filename = pathFromContent(content) || ''
    }

    if (!filename) {
      filename = inferFilename(lang || 'txt', content, agentId, ++i)
    } else {
      i++
    }

    let finalName = filename
    let n = 2
    while (used.has(finalName)) {
      const parts = filename.split('.')
      if (parts.length > 1) {
        const ext = parts.pop()
        finalName = `${parts.join('.')}-${n}.${ext}`
      } else {
        finalName = `${filename}-${n}`
      }
      n++
    }
    used.add(finalName)

    artifacts.push({ filename: finalName, language: lang || 'text', content })
  }

  return { cleanText: text, artifacts }
}

export const PROVIDERS = {
  groq: {
    name: 'Groq (Recommended - Super Cepat)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
    ],
    help: 'Free tier: pakai openai/gpt-oss-20b (paling sering tersedia). Llama sering 404. App auto-retry + jeda antar agent.',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    help: 'Daftar gratis di https://aistudio.google.com/apikey',
  },
  openrouter: {
    name: 'OpenRouter (model gratis)',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'google/gemini-2.0-flash-exp:free',
      'openai/gpt-oss-120b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ],
    help: 'Daftar di https://openrouter.ai → Keys (model :free)',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini'],
    help: 'Isi base URL & model sendiri',
  },
} as const
