/** Pipeline otomatis setelah agent selesai — minim campur tangan user */

import { cleanRepoJunk, isJunkPath } from './repoCleanup'
import type { GitHubConfig } from './github'
import { listRepoFiles } from './github'
import { deployToVercel } from './vercel'
import { openPreviewBrowser, verifyLiveUrl, formatVerifyReport, type VerifyResult } from './verifyDeploy'

export function wantsFullAuto(task: string): boolean {
  const t = task.toLowerCase()
  // jangan anggap "cek status" / pertanyaan sebagai full auto
  if (/\b(cek|status|apakah|kenapa|mengapa|bagaimana|jelaskan)\b/.test(t) && !/\b(perbaiki|buat|bikin|deploy ulang)\b/.test(t)) {
    return false
  }
  return /\b(buat|bikin|implement|tulis|scaffold|full otomatis|tanpa campur|selesaikan semua)\b/.test(t)
}

export function shouldAutoDeploy(task: string): boolean {
  const t = task.toLowerCase()
  // "cek status deploy" / "apakah sudah online" → JANGAN auto-deploy
  if (/\b(cek|periksa|lihat|status|apakah|sudah|belum)\b/.test(t) && /\b(deploy|vercel|online|hosting)\b/.test(t)) {
    return false
  }
  if (/\b(cek|status|apakah|kenapa|bagaimana|jelaskan)\b/.test(t) && !/\b(perbaiki|buat|bikin|deploy ulang|publish)\b/.test(t)) {
    return false
  }
  // deploy eksplisit atau bangun app lalu online
  if (/\b(deploy|publish|online-kan)\b/.test(t)) return true
  if (/\b(buat|bikin|perbaiki).{0,40}\b(dashboard|aplikasi|website|app)\b/.test(t) && /\b(vercel|online|deploy|hosting)\b/.test(t)) {
    return true
  }
  return false
}

export function filterProductionArtifacts(
  arts: { filename: string; content: string; action?: string }[]
): { filename: string; content: string; action?: string }[] {
  return arts.filter((a) => {
    if (a.action === 'delete') return true
    const f = (a.filename || '').replace(/^\/+/, '')
    if (!f || f.length > 80) return false
    if (isJunkPath(f)) return false
    if (/^output[-_]/i.test(f.split('/').pop() || '')) return false
    if (/\.(sh|dotenv)$/i.test(f)) return false
    if (/^app-\d/i.test(f)) return false
    if (
      /^(index\.html|styles\.css|app\.js|README\.md|package\.json|vercel\.json|\.gitignore)$/i.test(f) ||
      f.startsWith('api/') ||
      f.startsWith('migrations/') ||
      f.startsWith('src/') ||
      f.startsWith('public/') ||
      /\.(html|css|js|ts|tsx|json|md|sql)$/i.test(f)
    ) {
      return true
    }
    return false
  })
}

export async function autoCleanAfterPush(
  cfg: GitHubConfig,
  addMessage: (from: string, text: string) => void
): Promise<{ junkFound: number; deleted: string[] }> {
  try {
    const files = await listRepoFiles(cfg, 300)
    const junk = files.filter(isJunkPath)
    if (!junk.length) return { junkFound: 0, deleted: [] }
    addMessage('System', `Auto-bersih ${junk.length} file sampah di remote...`)
    const result = await cleanRepoJunk(cfg)
    if (result.deleted.length) {
      addMessage('System', `Auto-bersih selesai: ${result.deleted.length} file dihapus.`)
    }
    return { junkFound: junk.length, deleted: result.deleted || [] }
  } catch (e: unknown) {
    addMessage('System', 'Auto-bersih gagal: ' + (e instanceof Error ? e.message : String(e)))
    return { junkFound: 0, deleted: [] }
  }
}

export async function autoDeployIfNeeded(opts: {
  task: string
  vercelToken?: string
  repoName?: string
  files: { path: string; content: string }[]
  addMessage: (from: string, text: string) => void
  openBrowser?: boolean
  verify?: boolean
}): Promise<{ url: string | null; verify: VerifyResult | null }> {
  if (!opts.vercelToken?.trim()) return { url: null, verify: null }
  if (!shouldAutoDeploy(opts.task)) return { url: null, verify: null }
  const files = opts.files.filter((f) => f.content && f.path)
  if (!files.length) return { url: null, verify: null }

  let url: string | null = null
  try {
    opts.addMessage('System', '5️⃣ [deploy] Deploy ke Vercel...')
    const dep = await deployToVercel({
      token: opts.vercelToken,
      name: opts.repoName || 'vo-app',
      files,
    })
    url = dep.url
    opts.addMessage('System', `5️⃣ [deploy] Online: ${url}`)
  } catch (e: unknown) {
    opts.addMessage('System', 'Auto-deploy: ' + (e instanceof Error ? e.message : String(e)))
    return { url: null, verify: null }
  }

  if (opts.openBrowser !== false && url) {
    opts.addMessage('System', '6️⃣ [verify] Membuka preview browser...')
    openPreviewBrowser(url)
  }

  let verify: VerifyResult | null = null
  if (opts.verify !== false && url) {
    opts.addMessage('System', '5️⃣ [deploy] Online — lanjut verifikasi URL')
    await new Promise((r) => setTimeout(r, 4000))
    opts.addMessage('System', '6️⃣ [verify] HTTP check halaman live...')
    verify = await verifyLiveUrl(url)
    // satu kali retry jika belum siap (cold start)
    if (verify && !verify.ok && !verify.protection && (verify.status === 0 || verify.status >= 500 || verify.status === 404)) {
      opts.addMessage('System', '6️⃣ [verify] Retry HTTP check (cold start)...')
      await new Promise((r) => setTimeout(r, 6000))
      verify = await verifyLiveUrl(url)
    }
    opts.addMessage('System', formatVerifyReport(verify))
    if (verify.ok) {
      opts.addMessage('System', `6️⃣ [verify] Cuplikan: ${(verify.title || verify.snippet || 'OK').slice(0, 120)}`)
    }
  }

  return { url, verify }
}
