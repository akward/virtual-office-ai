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

function normTask(task: string, max = 1200): string {
  return task
    .slice(0, max)
    .toLowerCase()
    .replace(/[`*_#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Spek / PRD / permintaan implementasi proyek */
function looksLikeProjectSpec(task: string): boolean {
  const t = normTask(task, 2000)
  if (task.length > 400) {
    const markers =
      /\b(proyek|project|tujuan|output yang diminta|skema database|endpoint|prisma|role|dashboard|autentikasi|teknologi|struktur folder|spesifikasi|requirements|fitur|schema|middleware|rbac|jwt)\b/.test(
        t
      )
    if (markers) return true
  }
  return /\b(membangun|bangun|implementasikan|implementasi|kembangkan|buatkan|scaffolding|full stack|full-stack)\b/.test(t)
}

/**
 * Heuristik cepat (fallback jika LLM gagal).
 * Spek panjang / PRD selalu build.
 */
export function classifyTaskIntent(task: string): TaskIntent {
  const t = normTask(task)

  // Spek proyek lengkap → build (bukan tanya)
  if (looksLikeProjectSpec(task)) return 'build'

  const wantsMutate =
    /\b(perbaiki|perbaikan|memperbaiki|fix|buat|bikin|buatkan|tulis|implement|implementasi|kodekan|generate|scaffold|hapus|bersihkan|buang|deploy ulang|redeploy|publish|online-kan|lakukan|kerjakan|selesaikan|update|ubah|ganti|membangun|bangun|kembangkan)\b/.test(
      t
    )

  const wantsAsk =
    /\b(cek|periksa|lihat|status|apa|apakah|kenapa|mengapa|bagaimana|jelaskan|ringkas|info|daftar|list|berapa|sudah|belum|bisakah|tolong bilang)\b/.test(
      t
    )

  // Tanya murni saja (pendek, tanpa aksi)
  if (wantsAsk && !wantsMutate && task.length < 280) {
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

  if (/\b(deploy|publish|online-kan)\b/.test(t) && (wantsMutate || !wantsAsk)) return 'deploy'

  if (/\b(buat|bikin|buatkan|tulis|implement|kodekan|generate|scaffold|tambahkan|membangun)\b/.test(t)) {
    return 'build'
  }

  // Teks panjang tanpa kata tanya murni → anggap build
  if (task.length > 350 && !wantsAsk) return 'build'
  if (task.length > 500) return 'build'

  if (t.length < 100 && wantsAsk && !wantsMutate) return 'ask'

  return wantsMutate ? 'build' : 'ask'
}

export function isChatOnlyTask(task: string): boolean {
  const intent = classifyTaskIntent(task)
  return intent === 'ask' || intent === 'status'
}

const INTENT_SYSTEM = `Kamu klasifikasi niat user untuk Virtual Office agent.
Balas PERSIS 1 kata saja (huruf kecil):
ask | status | cleanup | build | fix | deploy | delete

Arti:
- ask = hanya tanya singkat / minta penjelasan, TIDAK buat file
- status = cek status deploy/koneksi/akun saja
- cleanup = hapus file sampah
- build = buat/implementasikan aplikasi, fitur, spek, PRD, schema, endpoint, dashboard, kode baru
- fix = perbaiki bug/error
- deploy = deploy/publish
- delete = hapus banyak file

PENTING:
- Jika user mengirim SPEK/PRD panjang (role, database, endpoint, teknologi, output yang diminta) → build
- "Membangun aplikasi..." / "PROYEK: ..." / daftar fitur + schema → build
- Jangan pilih ask hanya karena ada kata "jelaskan" di dalam spek panjang

Contoh:
"cek status deploy" → status
"PROYEK: Dashboard... ROLE... SKEMA DATABASE... OUTPUT YANG DIMINTA" → build
"buat login user" → build
"apakah sudah online?" → status

Satu kata saja.`

/**
 * Klasifikasi niat dengan LLM; fallback heuristik.
 * Spek panjang: prioritaskan heuristik build agar tidak salah jadi ask.
 */
export async function classifyTaskIntentWithLLM(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model' | 'apiKey2' | 'baseUrl2' | 'model2'>,
  task: string
): Promise<TaskIntent> {
  const fallback = classifyTaskIntent(task)

  // Spek jelas → langsung build, jangan andalkan LLM yang sering bilang ask
  if (looksLikeProjectSpec(task) || fallback === 'build') {
    if (looksLikeProjectSpec(task)) return 'build'
  }

  if (!config?.apiKey?.trim()) return fallback

  try {
    const raw = await callLLM(
      config as AppConfig,
      INTENT_SYSTEM,
      `Perintah user (${task.length} karakter):\n${task.slice(0, 900)}\n\nNiat (1 kata):`,
      16
    )
    const word = (raw || '')
      .toLowerCase()
      .replace(/[^a-z]/g, ' ')
      .trim()
      .split(/\s+/)[0]
    let intent: TaskIntent | null = VALID.includes(word as TaskIntent) ? (word as TaskIntent) : null
    if (!intent) {
      for (const v of VALID) {
        if ((raw || '').toLowerCase().includes(v)) {
          intent = v
          break
        }
      }
    }
    if (!intent) return fallback

    // Lindungi: spek panjang tidak boleh jadi ask/status
    if ((intent === 'ask' || intent === 'status') && (looksLikeProjectSpec(task) || task.length > 500)) {
      return 'build'
    }
    return intent
  } catch {
    return fallback
  }
}

export function isChatOnlyIntent(intent: TaskIntent): boolean {
  return intent === 'ask' || intent === 'status'
}
