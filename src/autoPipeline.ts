/** Pipeline otomatis setelah agent selesai — minim campur tangan user */

import { cleanRepoJunk, isJunkPath } from './repoCleanup'
import type { GitHubConfig } from './github'
import { listRepoFiles } from './github'
import { deployToVercel } from './vercel'

export function wantsFullAuto(task: string): boolean {
  const t = task.toLowerCase()
  return /\b(buat|bikin|implement|dashboard|aplikasi|app|website|full|otomatis|otonomi|selesaiin|kerjakan|database|neon)\b/.test(t)
}

export function shouldAutoDeploy(task: string): boolean {
  const t = task.toLowerCase()
  return /\b(deploy|vercel|online|hosting|dashboard|aplikasi|website|app)\b/.test(t) || wantsFullAuto(task)
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
): Promise<void> {
  try {
    const files = await listRepoFiles(cfg, 300)
    const junk = files.filter(isJunkPath)
    if (!junk.length) return
    addMessage('System', `Auto-bersih ${junk.length} file sampah di remote...`)
    const result = await cleanRepoJunk(cfg)
    if (result.deleted.length) {
      addMessage('System', `Auto-bersih selesai: ${result.deleted.length} file dihapus.`)
    }
  } catch (e: unknown) {
    addMessage('System', 'Auto-bersih gagal: ' + (e instanceof Error ? e.message : String(e)))
  }
}

export async function autoDeployIfNeeded(opts: {
  task: string
  vercelToken?: string
  repoName?: string
  files: { path: string; content: string }[]
  addMessage: (from: string, text: string) => void
}): Promise<string | null> {
  if (!opts.vercelToken?.trim()) return null
  if (!shouldAutoDeploy(opts.task)) return null
  const files = opts.files.filter((f) => f.content && f.path)
  if (!files.length) return null
  try {
    opts.addMessage('System', 'Auto-deploy ke Vercel...')
    const dep = await deployToVercel({
      token: opts.vercelToken,
      name: opts.repoName || 'vo-app',
      files,
    })
    opts.addMessage('System', `Online: ${dep.url}`)
    return dep.url
  } catch (e: unknown) {
    opts.addMessage('System', 'Auto-deploy: ' + (e instanceof Error ? e.message : String(e)))
    return null
  }
}
