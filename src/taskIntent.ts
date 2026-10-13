/** Klasifikasi niat perintah user — agar agent tidak salah aksi */

export type TaskIntent =
  | 'ask'
  | 'status'
  | 'cleanup'
  | 'build'
  | 'fix'
  | 'deploy'
  | 'delete'

function normTask(task: string): string {
  return task
    .slice(0, 400)
    .toLowerCase()
    .replace(/[`*_#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Prioritas seperti asisten manusia:
 * "cek status deploy" = status (bukan deploy)
 * "perbaiki lalu deploy" = fix
 */
export function classifyTaskIntent(task: string): TaskIntent {
  const t = normTask(task)

  const isAskVerb =
    /\b(cek|periksa|lihat|status|apa|apakah|kenapa|mengapa|bagaimana|jelaskan|ringkas|info|daftar|list|berapa|sudah|belum|bisakah)\b/.test(
      t
    )
  const isMutateVerb =
    /\b(perbaiki|fix|buat|bikin|tulis|implement|kodekan|generate|scaffold|hapus semua|hapus file|push ulang|deploy ulang|redeploy|publish|online-kan)\b/.test(
      t
    )

  if (isAskVerb && !isMutateVerb) {
    if (/\b(status|deploy|vercel|online|hosting|terhubung|connected|akun|login|error|log)\b/.test(t)) {
      return 'status'
    }
    return 'ask'
  }

  if (/\b(hapus|bersihkan|buang).*(sampah|junk|output-|file sampah)\b/.test(t) || /\bbersihkan repo\b/.test(t)) {
    return 'cleanup'
  }
  if (/\bhapus semua file\b/.test(t) || /\bdelete all\b/.test(t)) return 'delete'

  if (/\b(perbaiki|fix|bug|debug|rusak|gagal|function_invocation|500|404)\b/.test(t)) return 'fix'

  if (/\b(deploy|publish|online-kan|hosting kan)\b/.test(t) && !/\b(cek|status|apakah)\b/.test(t)) {
    return 'deploy'
  }

  if (/\b(buat|bikin|tulis|implement|kodekan|generate|scaffold|tambahkan fitur)\b/.test(t)) return 'build'

  if (t.length < 120 && isAskVerb) return 'ask'

  return 'build'
}

export function isChatOnlyTask(task: string): boolean {
  const intent = classifyTaskIntent(task)
  return intent === 'ask' || intent === 'status'
}
