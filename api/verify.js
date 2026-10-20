/** Proxy verifikasi URL live — cek status + deteksi error (dengan proteksi SSRF) */

function isPrivateHostname(hostname) {
  const h = (hostname || '').toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv4
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const a = m.slice(1).map(Number)
    if (a[0] === 10) return true
    if (a[0] === 127) return true
    if (a[0] === 0) return true
    if (a[0] === 169 && a[1] === 254) return true
    if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true
    if (a[0] === 192 && a[1] === 168) return true
    if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true // CGNAT
    if (a[0] >= 224) return true // multicast/reserved
  }
  // IPv6 local
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  // cloud metadata
  if (h === 'metadata.google.internal' || h === 'metadata' || h.includes('169.254.169.254')) return true
  return false
}

function assertSafeUrl(raw) {
  let u
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    throw new Error('URL tidak valid')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('Hanya http/https')
  }
  // prefer https; still allow http for local previews only if not private — block private always
  if (isPrivateHostname(u.hostname)) {
    throw new Error('URL privat/metadata diblokir (SSRF protection)')
  }
  if (u.username || u.password) {
    throw new Error('URL dengan kredensial diblokir')
  }
  // block odd ports often used internally
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  if (![80, 443, 8080, 3000, 4173, 5173].includes(port) && port < 1024) {
    throw new Error('Port tidak diizinkan')
  }
  return u
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'Invalid JSON' }) }
  }
  body = body || {}

  let parsed
  try {
    parsed = assertSafeUrl(body.url)
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'url invalid' })
  }

  const url = parsed.toString()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'VirtualOfficeAI-Verify/1.1',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(timer)

    // Re-check final URL after redirects
    try {
      assertSafeUrl(r.url || url)
    } catch {
      return res.status(400).json({ error: 'Redirect ke host privat diblokir', finalUrl: r.url })
    }

    const ct = (r.headers.get('content-type') || '').toLowerCase()
    const text = await r.text()
    const snippet = text.slice(0, 8000)

    const issues = []
    if (r.status >= 400) issues.push(`HTTP ${r.status}`)
    if (/APPLICATION_ERROR|FUNCTION_INVOCATION_FAILED|DEPLOYMENT_NOT_FOUND|This page doesn.t exist|never existed/i.test(snippet)) {
      issues.push('Vercel application error / DEPLOYMENT_NOT_FOUND')
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

    const protection =
      r.status === 401 ||
      /deployment protection|vercel authentication|sso-api|_vercel_sso|login to view/i.test(snippet)

    const ok = r.ok && !protection && issues.length === 0

    return res.status(200).json({
      ok,
      status: r.status,
      title,
      issues: protection
        ? ['Vercel Deployment Protection (401/SSO)', ...issues]
        : issues,
      snippet: snippet.slice(0, 1200),
      finalUrl: r.url || url,
      protection,
      contentType: ct.slice(0, 80),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const aborted = /abort/i.test(msg)
    return res.status(200).json({
      ok: false,
      status: 0,
      title: '',
      issues: [aborted ? 'Timeout verifikasi (12s)' : msg],
      snippet: '',
      finalUrl: url,
      protection: false,
    })
  }
}
