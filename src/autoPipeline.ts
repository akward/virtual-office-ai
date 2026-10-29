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
    if (!f || f.length > 120) return false
    if (isJunkPath(f)) return false
    if (/^src\/snippet/i.test(f)) return false
    if (/^docs\/note-/i.test(f)) return false
    if (/^output[-_]/i.test(f.split('/').pop() || '')) return false
    if (/\.(sh|dotenv)$/i.test(f)) return false
    if (/^app-\d/i.test(f)) return false
    // Tolak path framework yang sering salah di repo static SPA
    if (/^(pages|app)\//i.test(f) && /\.(jsx|tsx)$/i.test(f)) return false
    if (/^src\/(components|pages)\//i.test(f) && !/^src\/(api|lib)\//i.test(f)) {
      // izinkan hanya jika bukan React page acak — tetap filter ketat di validate
    }
    const content = String(a.content ?? '')
    // JANGAN pernah push file inti kosong (penyebab UI "semakin jelek")
    const isCore = /^(index\.html|styles\.css|app\.js|package\.json|vercel\.json)$/i.test(f) || /^api\/[\w.-]+\.js$/i.test(f)
    if (isCore && content.trim().length < 20) return false
    // Tolak package.json yang memaksa CRA / Next tanpa diminta
    if (/^package\.json$/i.test(f)) {
      if (/react-scripts|next\b|"next":/i.test(content) && !/neondatabase/i.test(content)) {
        // izinkan hanya jika memang pure static + neon; jika ada react-scripts tanpa entry SPA kita tolak
        if (/react-scripts|create-react-app|"next":/i.test(content)) return false
      }
    }
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

/** Validasi keras sebelum push — cegah wipe & stack salah */
export function isDashboardOrAppTask(task: string): boolean {
  const t = (task || '').toLowerCase()
  return /\b(dashboard|monitoring|aplikasi|website|halaman|ui|tampilan|sla|form|login|realisasi|buatkan|bikin app|web app)\b/.test(t)
}

export function validateArtifactsForPush(
  arts: { filename: string; content: string; action?: string }[],
  userTask: string
): { ok: boolean; reason: string; arts: { filename: string; content: string; action?: string }[] } {
  const t = (userTask || '').toLowerCase()
  const cleaned = filterProductionArtifacts(arts)
  if (!cleaned.length) {
    return { ok: false, reason: 'Tidak ada file produksi valid untuk di-push', arts: [] }
  }
  for (const a of cleaned) {
    if (a.action === 'delete') continue
    const f = a.filename
    const c = String(a.content || '')
    if (/^(index\.html|app\.js|styles\.css)$/i.test(f) && c.trim().length < 80) {
      return { ok: false, reason: `File inti ${f} hampir kosong — push dibatalkan (cegah wipe)`, arts: cleaned }
    }
    if (/^package\.json$/i.test(f) && /react-scripts|"next":/i.test(c)) {
      return { ok: false, reason: 'package.json mengarah ke CRA/Next — ditolak untuk repo static SPA', arts: cleaned }
    }
    if (/vercel\.json$/i.test(f) && /create-react-app|"outputDirectory":\s*"build"/i.test(c)) {
      return { ok: false, reason: 'vercel.json CRA/build — ditolak; gunakan static rewrites', arts: cleaned }
    }
    // Express server.js sebagai satu-satunya "app" di Vercel sering gagal
    if (/^server\.js$/i.test(f) && /express|app\.listen/i.test(c) && isDashboardOrAppTask(t)) {
      const hasUi = cleaned.some(
        (x) => /^index\.html$/i.test(x.filename) && String(x.content || '').length > 200
      )
      if (!hasUi) {
        return {
          ok: false,
          reason: 'Dashboard Vercel butuh index.html (+ styles.css/app.js), bukan hanya Express server.js',
          arts: cleaned,
        }
      }
    }
  }

  const names = cleaned.map((a) => a.filename.toLowerCase())
  const hasIndex = cleaned.some((a) => /^index\.html$/i.test(a.filename) && String(a.content || '').length > 200)
  const hasStyles = cleaned.some((a) => /^styles\.css$/i.test(a.filename) && String(a.content || '').length > 100)
  const hasAppJs = cleaned.some((a) => /^app\.js$/i.test(a.filename) && String(a.content || '').length > 200)
  const onlyDocs =
    cleaned.length > 0 &&
    cleaned.every(
      (a) =>
        a.action === 'delete' ||
        /\.(md|txt)$/i.test(a.filename) ||
        /^src\/snippet/i.test(a.filename) ||
        /^docs\//i.test(a.filename)
    )

  if (onlyDocs && isDashboardOrAppTask(t)) {
    return {
      ok: false,
      reason: 'Hanya README/snippet — ditolak. Wajib index.html + styles.css + app.js (dan api/* bila perlu)',
      arts: cleaned,
    }
  }

  if (isDashboardOrAppTask(t) && !/hanya\s+readme|dokumentasi saja/.test(t)) {
    if (!hasIndex) {
      return {
        ok: false,
        reason: 'Tugas dashboard/monitoring wajib menghasilkan index.html lengkap (bukan hanya package.json/README)',
        arts: cleaned,
      }
    }
    const indexArt = cleaned.find((a) => /^index\.html$/i.test(a.filename))
    const indexHtml = String(indexArt?.content || '')
    // HTML mandiri: CSS/JS tertanam di index.html dianggap cukup
    const selfContained =
      indexHtml.length > 400 &&
      (/<style[\s>]/i.test(indexHtml) || /style\s*=/i.test(indexHtml)) &&
      (/<script[\s>]/i.test(indexHtml) || /onclick=/i.test(indexHtml))
    if (!hasStyles && !hasAppJs && !selfContained) {
      return {
        ok: false,
        reason:
          'Dashboard wajib styles.css + app.js, ATAU index.html mandiri berisi <style> dan <script> yang berfungsi',
        arts: cleaned,
      }
    }
  }

  if (/\b(tampilan|ui|css|bagus|rapi|input realisasi|halaman|perbaiki tampilan)\b/.test(t)) {
    const touched = cleaned.some(
      (a) => /^(styles\.css|app\.js|index\.html)$/i.test(a.filename) && (a.content || '').length > 80
    )
    if (!touched) {
      return {
        ok: false,
        reason: 'Perbaikan tampilan wajib mengubah styles.css / app.js / index.html (bukan hanya docs)',
        arts: cleaned,
      }
    }
  }

  if (/\b(email|reminder|nodemailer|smtp)\b/.test(t) && isDashboardOrAppTask(t)) {
    const hasApi = cleaned.some((a) => /^api\/.+\.js$/i.test(a.filename) && String(a.content || '').length > 100)
    if (!hasApi && !hasAppJs) {
      return {
        ok: false,
        reason: 'Fitur email/reminder wajib ada api/*.js atau logika di app.js',
        arts: cleaned,
      }
    }
  }

  return { ok: true, reason: '', arts: cleaned }
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
