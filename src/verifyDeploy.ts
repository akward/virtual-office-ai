/** Verifikasi hasil deploy: buka browser + cek halaman live + sinyal untuk auto-heal */

export type VerifyResult = {
  ok: boolean
  status: number
  title: string
  issues: string[]
  snippet: string
  finalUrl: string
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
    return {
      ok: Boolean(data.ok),
      status: Number(data.status || 0),
      title: String(data.title || ''),
      issues: Array.isArray(data.issues) ? data.issues.map(String) : [],
      snippet: String(data.snippet || '').slice(0, 1200),
      finalUrl: String(data.finalUrl || url),
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
  const issues = v.issues.length ? v.issues.join('; ') : 'unknown'
  return `⚠️ Live bermasalah (${v.status}): ${issues} · ${v.finalUrl}`
}

/** Prompt perbaikan singkat untuk agent coder */
export function buildHealPrompt(userTask: string, verify: VerifyResult, fileList: string[]): string {
  return [
    'Perbaiki aplikasi yang sudah di-deploy agar siap pakai.',
    `Tugas awal user: ${userTask.slice(0, 400)}`,
    `URL live: ${verify.finalUrl}`,
    `HTTP status: ${verify.status}`,
    `Masalah: ${verify.issues.join('; ') || 'tidak jelas'}`,
    verify.snippet ? `Cuplikan halaman:\n${verify.snippet.slice(0, 800)}` : '',
    `File terkait: ${fileList.slice(0, 15).join(', ')}`,
    'Output HANYA file lengkap yang perlu diubah (```html:index.html dll). Jangan buat file sampah output-*. Jangan penjelasan panjang.',
  ]
    .filter(Boolean)
    .join('\n')
}
