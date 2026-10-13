/** Verifikasi hasil deploy: buka browser + cek halaman live + sinyal untuk auto-heal */

export type VerifyResult = {
  ok: boolean
  status: number
  title: string
  issues: string[]
  snippet: string
  finalUrl: string
  /** true = Vercel Authentication / Deployment Protection, bukan bug kode */
  protection?: boolean
}

/** Buka tab/popup agar user melihat hasil (browser check visual) */
export function openPreviewBrowser(url: string): void {
  if (!url || typeof window === 'undefined') return
  try {
    window.open(url, 'vo_preview', 'noopener,noreferrer')
  } catch {
    try {
      window.open(url, '_blank')
    } catch {
      /* ignore */
    }
  }
}

export function isVercelProtection(v: VerifyResult): boolean {
  if (v.protection) return true
  if (v.status === 401) return true
  const blob = (v.issues.join(' ') + ' ' + v.snippet + ' ' + v.title).toLowerCase()
  return /deployment protection|vercel authentication|sso-api|unauthorized|_vercel_sso|login to view/i.test(blob)
}

/** Cek URL lewat proxy serverless /api/verify */
export async function verifyLiveUrl(url: string): Promise<VerifyResult> {
  const empty: VerifyResult = {
    ok: false,
    status: 0,
    title: '',
    issues: ['verify gagal'],
    snippet: '',
    finalUrl: url,
  }
  if (!url?.trim()) return { ...empty, issues: ['URL kosong'] }

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok && !data) {
      return { ...empty, issues: [`Proxy verify HTTP ${res.status}`] }
    }
    const status = Number(data.status || 0)
    const issues = Array.isArray(data.issues) ? data.issues.map(String) : []
    const snippet = String(data.snippet || '').slice(0, 1200)
    const protection =
      Boolean(data.protection) ||
      status === 401 ||
      /sso-api|deployment protection|vercel authentication|_vercel_sso/i.test(snippet + issues.join(' '))

    return {
      ok: Boolean(data.ok) && !protection,
      status,
      title: String(data.title || ''),
      issues: protection
        ? [
            'Vercel Deployment Protection aktif (401/SSO). Bukan error kode. Nonaktifkan di Project → Settings → Deployment Protection, atau buka URL sambil login Vercel.',
            ...issues,
          ]
        : issues,
      snippet,
      finalUrl: String(data.finalUrl || url),
      protection,
    }
  } catch (e: unknown) {
    return {
      ...empty,
      issues: [e instanceof Error ? e.message : 'fetch verify gagal'],
    }
  }
}

export function formatVerifyReport(v: VerifyResult): string {
  if (v.ok) {
    return `✅ Live OK (${v.status})${v.title ? ` — ${v.title}` : ''} · ${v.finalUrl}`
  }
  if (isVercelProtection(v)) {
    return `🔒 URL dilindungi Vercel Authentication (401/SSO). Bukan bug aplikasi. Nonaktifkan Deployment Protection di dashboard Vercel, atau buka link sambil login. · ${v.finalUrl}`
  }
  const issues = v.issues.length ? v.issues.join('; ') : 'unknown'
  return `⚠️ Live bermasalah (${v.status}): ${issues} · ${v.finalUrl}`
}

/** Prompt perbaikan singkat untuk agent coder */
export function buildHealPrompt(userTask: string, verify: VerifyResult, fileList: string[]): string {
  if (isVercelProtection(verify)) {
    return [
      'JANGAN ubah kode aplikasi.',
      'Masalah: Vercel Deployment Protection (HTTP 401 / SSO).',
      'Beritahu user: buka Vercel → project → Settings → Deployment Protection → matikan atau set hanya Preview.',
      'Output teks singkat saja, tanpa file fence.',
    ].join('\n')
  }
  return [
    'Perbaiki aplikasi yang sudah di-deploy agar siap pakai.',
    `Tugas awal user: ${userTask.slice(0, 400)}`,
    `URL live: ${verify.finalUrl}`,
    `HTTP status: ${verify.status}`,
    `Masalah: ${verify.issues.join('; ') || 'tidak jelas'}`,
    verify.snippet ? `Cuplikan halaman:\n${verify.snippet.slice(0, 800)}` : '',
    `File terkait: ${fileList.slice(0, 15).join(', ')}`,
    'Output HANYA file lengkap static: ```html:index.html ```css:styles.css ```js:app.js. Jangan React/Next src/pages. Jangan output-*.',
  ]
    .filter(Boolean)
    .join('\n')
}
