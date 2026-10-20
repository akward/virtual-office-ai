/** Observability: langkah pipeline, diff GitHub, riwayat tugas */

export type PipelineStep =
  | 'intent'
  | 'plan'
  | 'files'
  | 'push'
  | 'deploy'
  | 'verify'
  | 'checklist'
  | 'done'
  | 'error'

export type StepLog = {
  step: PipelineStep
  label: string
  ok?: boolean
  detail?: string
  at: string
}

const STEP_EMOJI: Record<PipelineStep, string> = {
  intent: '1️⃣',
  plan: '2️⃣',
  files: '3️⃣',
  push: '4️⃣',
  deploy: '5️⃣',
  verify: '6️⃣',
  checklist: '✅',
  done: '🏁',
  error: '❌',
}

export function formatStep(step: PipelineStep, label: string, detail?: string): string {
  const em = STEP_EMOJI[step] || '•'
  return detail ? `${em} [${step}] ${label} — ${detail}` : `${em} [${step}] ${label}`
}

export function formatGitDiff(opts: {
  changed: string[]
  deleted?: string[]
  errors?: string[]
}): string {
  const nCh = opts.changed?.length || 0
  const nDel = opts.deleted?.length || 0
  const nErr = opts.errors?.length || 0
  const parts = [`📦 Diff GitHub: ${nCh} file diubah`]
  if (nDel) parts[0] += `, ${nDel} sampah/dihapus`
  if (nErr) parts[0] += `, ${nErr} gagal`
  const lines = [parts[0]]
  if (nCh && nCh <= 12) lines.push('   → ' + opts.changed.join(', '))
  else if (nCh > 12) lines.push('   → ' + opts.changed.slice(0, 10).join(', ') + ` …(+${nCh - 10})`)
  if (nDel && nDel <= 8) lines.push('   🗑️ ' + (opts.deleted || []).join(', '))
  return lines.join('\n')
}

export type TaskStatus = 'success' | 'fail' | 'partial' | 'ask' | 'cancelled'

export function decideTaskStatus(opts: {
  intent?: string
  chatOnly?: boolean
  cancelled?: boolean
  fileCount: number
  pushErrors?: number
  deployUrl?: string | null
  verifyOk?: boolean | null
  checklistFail?: number
  threw?: boolean
}): TaskStatus {
  if (opts.cancelled) return 'cancelled'
  if (opts.threw) return 'fail'
  if (opts.chatOnly || opts.intent === 'ask' || opts.intent === 'status') return 'ask'
  const hardFail =
    (opts.pushErrors && opts.pushErrors > 0 && opts.fileCount === 0) ||
    (opts.verifyOk === false && Boolean(opts.deployUrl))
  if (hardFail) return 'fail'
  const soft =
    (opts.checklistFail && opts.checklistFail > 0) ||
    (opts.pushErrors && opts.pushErrors > 0) ||
    (opts.fileCount === 0 && opts.intent === 'build')
  if (soft) return 'partial'
  return 'success'
}

export function buildTaskSummary(opts: {
  status: TaskStatus
  intent?: string
  files?: string[]
  deleted?: string[]
  deployUrl?: string | null
  verify?: string | null
  checklist?: string
  error?: string
}): string {
  const lines = [
    `status=${opts.status}`,
    opts.intent ? `intent=${opts.intent}` : '',
    opts.files?.length ? `files=${opts.files.slice(0, 15).join('|')}` : 'files=—',
    opts.deleted?.length ? `deleted=${opts.deleted.slice(0, 10).join('|')}` : '',
    opts.deployUrl ? `url=${opts.deployUrl}` : '',
    opts.verify ? `verify=${opts.verify}` : '',
    opts.checklist ? `checklist=${opts.checklist}` : '',
    opts.error ? `error=${opts.error.slice(0, 200)}` : '',
  ].filter(Boolean)
  return lines.join('\n').slice(0, 1800)
}
