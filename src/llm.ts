import type { AppConfig } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseRetryMs(errBody: string, attempt: number): number {
  const m = errBody.match(/try again in\s+([\d.]+)\s*s/i)
  if (m) {
    return Math.min(90000, Math.ceil(parseFloat(m[1]) * 1000) + 500)
  }
  return Math.min(60000, 15000 * (attempt + 1))
}

/** Call LLM with automatic retry on rate limit (429) */
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
        `Rate limit Groq (TPM). Sudah dicoba ${maxAttempts}x. Tunggu 1–2 menit lalu kirim lagi, atau ganti model ke llama-3.1-8b-instant. Detail: ${lastErr}`
      )
    }

    throw new Error(`LLM Error ${res.status}: ${lastErr}`)
  }

  throw new Error(`LLM gagal setelah retry: ${lastErr}`)
}

/** Pause between agent calls to stay under free-tier TPM */
export async function paceBetweenAgents(ms = 12000): Promise<void> {
  await sleep(ms)
}

export function extractArtifacts(
  text: string,
  agentId: string
): { cleanText: string; artifacts: { filename: string; language: string; content: string }[] } {
  const artifacts: { filename: string; language: string; content: string }[] = []
  const re = /```([a-zA-Z0-9_+-]*)(?::([^\n]+))?\n([\s\S]*?)```/g
  let match
  let i = 0

  while ((match = re.exec(text)) !== null) {
    const lang = (match[1] || 'txt').toLowerCase()
    let filename = (match[2] || '').trim()
    const content = match[3].trim()
    if (!content) continue

    if (!filename) {
      const ext =
        lang === 'javascript' || lang === 'js'
          ? 'js'
          : lang === 'typescript' || lang === 'ts'
            ? 'ts'
            : lang === 'tsx'
              ? 'tsx'
              : lang === 'python' || lang === 'py'
                ? 'py'
                : lang === 'html'
                  ? 'html'
                  : lang === 'css'
                    ? 'css'
                    : lang === 'json'
                      ? 'json'
                      : lang === 'markdown' || lang === 'md'
                        ? 'md'
                        : lang === 'bash' || lang === 'shell'
                          ? 'sh'
                          : 'txt'
      filename = `output-${agentId}-${++i}.${ext}`
    }

    artifacts.push({ filename, language: lang || 'text', content })
  }

  return { cleanText: text, artifacts }
}

export const PROVIDERS = {
  groq: {
    name: 'Groq (Recommended - Super Cepat)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'llama-3.1-8b-instant',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
    ],
    help: 'Free tier: limit token/menit. App sudah auto-retry + jeda antar agent. Model paling aman: llama-3.1-8b-instant',
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
