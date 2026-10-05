import type { AppConfig } from './types'

export async function callLLM(
  config: AppConfig,
  systemPrompt: string,
  userMessage: string
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
      temperature: 0.7,
      max_tokens: 800,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM Error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || 'Tidak ada respons.'
}

export const PROVIDERS = {
  groq: {
    name: 'Groq (Recommended - Super Cepat)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
    help: 'Daftar gratis di https://console.groq.com → API Keys (tanpa kartu kredit)',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    help: 'Daftar gratis di https://aistudio.google.com/apikey (tanpa kartu kredit)',
  },
  openrouter: {
    name: 'OpenRouter (banyak model gratis)',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
    help: 'Daftar di https://openrouter.ai → Keys (ada model :free)',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini'],
    help: 'Isi base URL & model sendiri',
  },
} as const
