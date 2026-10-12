/** Proxy verifikasi URL live — cek status + deteksi error tanpa CORS browser */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'Invalid JSON' }) }
  }
  body = body || {}

  const url = String(body.url || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'url https required' })
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'VirtualOfficeAI-Verify/1.0',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(timer)

    const ct = (r.headers.get('content-type') || '').toLowerCase()
    const text = await r.text()
    const snippet = text.slice(0, 8000)

    const issues = []
    if (r.status >= 400) issues.push(`HTTP ${r.status}`)
    if (/APPLICATION_ERROR|FUNCTION_INVOCATION_FAILED|DEPLOYMENT_NOT_FOUND/i.test(snippet)) {
      issues.push('Vercel application error')
    }
    if (/This Serverless Function has crashed|A server error has occurred/i.test(snippet)) {
      issues.push('Serverless function crashed')
    }
    if (/Cannot find module|Module not found|ENOENT/i.test(snippet)) {
      issues.push('Module / file not found')
    }
    if (/SyntaxError|ReferenceError|TypeError/i.test(snippet)) {
      issues.push('JavaScript runtime error detected in page')
    }
    if (/404|NOT_FOUND/i.test(snippet) && r.status === 404) {
      issues.push('Page not found (404)')
    }
    if (!snippet.trim() && r.ok) issues.push('Empty response body')

    let title = ''
    const tm = snippet.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (tm) title = tm[1].trim().slice(0, 120)

    const hasAppShell =
      /<html/i.test(snippet) ||
      /<body/i.test(snippet) ||
      ct.includes('json')

    const ok = r.status >= 200 && r.status < 400 && issues.length === 0 && (hasAppShell || ct.includes('json'))

    return res.status(200).json({
      ok,
      status: r.status,
      title,
      contentType: ct,
      issues,
      snippet: snippet.slice(0, 1500),
      finalUrl: r.url || url,
    })
  } catch (e) {
    return res.status(200).json({
      ok: false,
      status: 0,
      issues: [e instanceof Error ? e.message : String(e)],
      snippet: '',
      title: '',
    })
  }
}
