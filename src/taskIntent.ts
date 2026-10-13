/** Klasifikasi niat perintah — heuristik + LLM (seperti ChatGPT/Grok) */

import type { AppConfig } from './types'
import { callLLM } from './llm'

export type TaskIntent =
  | 'ask'
  | 'status'
  | 'cleanup'
  | 'build'
  | 'fix'
  | 'deploy'
  | 'delete'

const VALID: TaskIntent[] = ['ask', 'status', 'cleanup', 'build', 'fix', 'deploy', 'delete']

function normTask(task: string): string {
  return task
    .slice(0, 500)
    .toLowerCase()
    .replace(/[`*_#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Heuristik cepat (fallback jika LLM gagal).
 * Mutasi menang atas "cek" bila keduanya ada.
 */
export function classifyTaskIntent(task: string): TaskIntent {
  const t = normTask(task)

  const wantsMutate =
    /\b(perbaiki|perbaikan|memperbaiki|fix|buat|bikin|tulis|implement|kodekan|generate|scaffold|hapus|bersihkan|buang|deploy ulang|redeploy|publish|online-kan|lakukan|kerjakan|selesaikan|update|ubah|ganti)\b/.test(
      t
    )

  const wantsAsk =
    /\b(cek|periksa|lihat|status|apa|apakah|kenapa|mengapa|bagaimana|jelaskan|ringkas|info|daftar|list|berapa|sudah|belum|bisakah|tolong bilang)\b/.test(
      t
    )

  // Tanya murni saja
  if (wantsAsk && !wantsMutate) {
    if (/\b(status|deploy|vercel|online|hosting|terhubung|connected|akun|login|error|log)\b/.test(t)) {
      return 'status'
    }
    return 'ask'
  }

  if (/\b(hapus|bersihkan|buang).*(sampah|junk|output-|file)\b/.test(t) || /\bbersihkan repo\b/.test(t)) {
    return 'cleanup'
  }
  if (/\bhapus semua file\b/.test(t) || /\bdelete all\b/.test(t)) return 'delete'

  if (/\b(perbaiki|perbaikan|memperbaiki|fix|bug|debug|rusak|gagal|function_invocation|500|404)\b/.test(t)) {
    return 'fix'
  }

  if (/\b(deploy|publish|online-kan)\b/.test(t) && wantsMutate) return 'deploy'
  if (/\b(deploy|publish|online-kan)\b/.test(t) && !wantsAsk) return 'deploy'

  if (/\b(buat|bikin|tulis|implement|kodekan|generate|scaffold|tambahkan)\b/.test(t)) return 'build'

  if (t.length < 100 && wantsAsk && !wantsMutate) return 'ask'

  return wantsMutate ? 'build' : 'ask'
}

export function isChatOnlyTask(task: string): boolean {
  const intent = classifyTaskIntent(task)
  return intent === 'ask' || intent === 'status'
}

const INTENT_SYSTEM = `Kamu klasifikasi niat user untuk Virtual Office agent.
Balas PERSIS 1 kata saja dari daftar ini (huruf kecil):
ask | status | cleanup | build | fix | deploy | delete

Arti:
- ask = hanya tanya / minta penjelasan, tidak ubah file
- status = cek status deploy/koneksi/akun, tidak ubah file
- cleanup = hapus file sampah di repo
- build = buat fitur/aplikasi/file baru
- fix = perbaiki bug/error/dashboard/deploy yang rusak
- deploy = deploy/publish ke Vercel/hosting
- delete = hapus banyak file di repo

Contoh:
"cek status deploy realisasi-anggaran" → status
"cek dan lakukan perbaikan pada deploy" → fix
"perbaiki dashboard lalu deploy" → fix
"buat login user" → build
"hapus file sampah" → cleanup
"apakah sudah online?" → status
"jelaskan cara kerja agent" → ask

Jangan jelaskan. Satu kata saja.`

/**
 * Klasifikasi niat dengan LLM (pemahaman natural language),
 * fallback ke heuristik jika gagal.
 */
export async function classifyTaskIntentWithLLM(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model' | 'apiKey2' | 'baseUrl2' | 'model2'>,
  task: string
): Promise<TaskIntent> {
  const fallback = classifyTaskIntent(task)
  if (!config?.apiKey?.trim()) return fallback

  try {
    const raw = await callLLM(
      config as AppConfig,
      INTENT_SYSTEM,
      `Perintah user:\n${task.slice(0, 400)}\n\nNiat (1 kata):`,
      16
    )
    const word = (raw || '')
      .toLowerCase()
      .replace(/[^a-z]/g, ' ')
      .trim()
      .split(/\s+/)[0]
    if (VALID.includes(word as TaskIntent)) return word as TaskIntent
    // kadang model jawab "intent: fix"
    for (const v of VALID) {
      if ((raw || '').toLowerCase().includes(v)) return v
    }
    return fallback
  } catch {
    return fallback
  }
}

export function isChatOnlyIntent(intent: TaskIntent): boolean {
  return intent === 'ask' || intent === 'status'
}
