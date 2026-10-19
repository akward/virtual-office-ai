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
            max_tokens: Math.min(maxTokens, 800),
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
            max_tokens: Math.min(maxTokens, 800),
          }),
        })
      }
    } catch (netErr: unknown) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr)
      throw new Error(msg || 'Failed to fetch')
    }
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
    lastErr = err.slice(0, 280)
    if (res.status === 402 || /more credits|can only afford|insufficient.*credit/i.test(err)) {
      throw new Error(`LLM Error 402: kredit API habis / tidak cukup. Isi kredit atau ganti provider. ${lastErr}`)
    }
    if (res.status === 429 || res.status === 503 || /UNAVAILABLE|high demand|overloaded|capacity/i.test(err)) {
      const wait = res.status === 503
        ? Math.min(45000, 4000 * (attempt + 1) + Math.floor(Math.random() * 1500))
        : parseRetryMs(err, attempt)
      if (attempt < maxAttempts - 1) {
        await sleep(wait)
        continue
      }
      throw new Error(
        res.status === 503
          ? `Model sibuk (503). Coba lagi atau ganti model/API #2. Detail: ${lastErr}`
          : `Rate limit. Sudah dicoba ${maxAttempts}x. Detail: ${lastErr}`
      )
    }
    throw new Error(`LLM Error ${res.status}: ${lastErr}`)
  }
  throw new Error(`LLM gagal setelah retry: ${lastErr}`)
}
