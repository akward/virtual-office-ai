/** Proxy Cloudflare Workers AI — browser tidak bisa CORS ke api.cloudflare.com */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'Invalid JSON' }) }
  }
  body = body || {}

  const auth = String(req.headers.authorization || '').trim()
  if (!auth) return res.status(401).json({ error: 'Authorization Bearer required' })

  const accountId = String(body.accountId || '').trim()
  const model = String(body.model || '').trim()
  if (!accountId || !model) {
    return res.status(400).json({ error: 'accountId and model required' })
  }

  const messages = body.messages
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] required' })
  }

  const max_tokens = Math.min(Number(body.max_tokens) || 800, 4096)
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.45

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, max_tokens, temperature }),
    })
    const text = await r.text()
    let data
    try { data = JSON.parse(text) } catch {
      return res.status(r.status).json({ error: text.slice(0, 500) })
    }

    if (!r.ok || data.success === false) {
      const msg =
        data?.errors?.[0]?.message ||
        data?.error ||
        data?.message ||
        text.slice(0, 400)
      return res.status(r.status >= 400 ? r.status : 502).json({
        error: msg,
        details: data?.errors || null,
      })
    }

    const content =
      data?.result?.response ||
      data?.result?.choices?.[0]?.message?.content ||
      data?.result?.choices?.[0]?.delta?.content ||
      (typeof data?.result === 'string' ? data.result : '') ||
      ''

    return res.status(200).json({
      choices: [{ message: { role: 'assistant', content: String(content || '').trim() } }],
      model: data?.result?.model || model,
      usage: data?.result?.usage || null,
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
