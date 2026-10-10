import { listRepoFiles, deleteManyFiles, type GitHubConfig } from './github'

export function wantsRepoCleanup(task: string): boolean {
  const t = task.toLowerCase()
  return (
    (/\b(hapus|bersih(kan)?|delete|remove)\b/.test(t) &&
      /\b(sampah|junk|output-|file sampah|bersihkan repo)\b/.test(t)) ||
    /hapus semua file (sampah|output)/i.test(t) ||
    /bersihkan repo/i.test(t)
  )
}

export function isJunkPath(p: string): boolean {
  const keepExact = new Set([
    'index.html',
    'styles.css',
    'app.js',
    'README.md',
    '.gitignore',
    'package.json',
    'vercel.json',
  ])
  if (keepExact.has(p)) return false
  if (p.startsWith('api/')) return false
  if (p.startsWith('migrations/')) return false
  const base = p.split('/').pop() || ''
  if (/^output[-_]/i.test(base)) return true
  if (/\.(sh|dotenv)$/i.test(p)) return true
  if (p.startsWith('app-') && p !== 'app.js') return true
  if (/^README\.md /i.test(p)) return true
  if (/^index\.html[)"']/.test(p)) return true
  if (p === '.env' || p.startsWith('.env.')) return true
  if (p === 'main.py') return true
  if (p.startsWith('pages/') || p.startsWith('prisma/') || p.startsWith('components/')) return true
  if (p.startsWith('src/api/')) return true
  if (p.startsWith('docs/')) return true
  if (p.length > 80) return true
  return false
}

export async function cleanRepoJunk(
  cfg: GitHubConfig
): Promise<{ deleted: string[]; errors: string[]; total: number }> {
  const all = await listRepoFiles(cfg, 400)
  const toDelete = all.filter(isJunkPath)
  if (!toDelete.length) return { deleted: [], errors: [], total: 0 }
  const { deleted, errors } = await deleteManyFiles(cfg, toDelete, 'VO: hapus sampah')
  return { deleted, errors, total: toDelete.length }
}
