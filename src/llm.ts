import type { AppConfig } from './types'

export async function callLLM(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('API Key belum diisi. Isi dulu di Settings.')
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM Error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || 'Tidak ada respons.'
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
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
    ],
    help: 'Daftar gratis di https://console.groq.com → API Keys. Jika model 404, pakai openai/gpt-oss-120b atau openai/gpt-oss-20b',
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
      'openai/gpt-oss-120b:free',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ],
    help: 'Daftar di https://openrouter.ai → Keys (cari model :free)',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini'],
    help: 'Isi base URL & model sendiri',
  },
} as const
