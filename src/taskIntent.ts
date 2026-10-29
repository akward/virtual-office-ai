/** Klasifikasi niat — pahami perintah seperti ChatGPT/Grok */

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

function normTask(task: string, max = 1600): string {
  return task
    .slice(0, max)
    .toLowerCase()
    .replace(/[`*_#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeProjectSpec(task: string): boolean {
  const t = normTask(task, 2500)
  if (task.length > 350) {
    const markers =
      /\b(proyek|project|tujuan|output yang diminta|skema database|endpoint|prisma|role dan hak|dashboard|autentikasi|teknologi|struktur folder|spesifikasi|requirements|schema|middleware|rbac|jwt|multi-user)\b/.test(
        t
      )
    if (markers) return true
  }
  return /\b(membangun|bangun|implementasikan|implementasi|kembangkan|buatkan aplikasi|scaffolding|full stack|full-stack)\b/.test(t)
}

function looksLikeStatusQuestion(task: string): boolean {
  const t = normTask(task)
  if (/\b(mana|dimana|where|url|alamat|link|domain)\b/.test(t) && /\b(vercel|deploy|online|hosting|live|production)\b/.test(t)) return true
  if (/^cek\b/.test(t) && t.length < 200) return true
  if (/\b(status|sudah online|apakah.*online|apakah.*deploy)\b/.test(t) && !/\b(perbaiki|buat|implement)\b/.test(t)) return true
  if (/\btampilannya\b/.test(t) && /\b(cek|lihat)\b/.test(t) && !/\b(perbaiki|buat ulang)\b/.test(t)) return true
  return false
}

export function classifyTaskIntent(task: string): TaskIntent {
  const t = normTask(task)

  if (looksLikeProjectSpec(task)) return 'build'

  // "cek URL + kerjakan / harus lebih rinci" = kerja, bukan status
  if (/\b(kerjakan|selesaikan|lanjutkan|sampai selesai|bisa digunakan)\b/.test(t) || (/\bharus\b/.test(t) && /\b(rinci|ubah|tambah|perbaiki)\b/.test(t))) {
    if (/\b(perbaiki|tampilan|rinci|dashboard|form|budget|realisasi)\b/.test(t)) return 'fix'
    return 'build'
  }

  if (looksLikeStatusQuestion(task) && !/\b(perbaiki|buat ulang|implement|membangun|kerjakan)\b/.test(t)) {
    return 'status'
  }

  if (/\b(tidak sesuai|belum sesuai|salah|bukan yang|masih skeleton|masih kosong|memuat data|tidak jalan|rusak|gagal)\b/.test(t)) {
    if (/\b(perbaiki|fix|buat ulang|sesuaikan|ulang)\b/.test(t) || task.length < 400) return 'fix'
  }

  const wantsMutate =
    /\b(perbaiki|perbaikan|memperbaiki|fix|buat|bikin|buatkan|tulis|implement|implementasi|kodekan|generate|scaffold|hapus|bersihkan|buang|deploy ulang|redeploy|publish|online-kan|lakukan|kerjakan|selesaikan|update|ubah|ganti|membangun|bangun|kembangkan|sesuaikan|tambahkan|tambah|isi|custom|kustom)\b/.test(
      t
    ) ||
    (/\bsaya ingin\b/.test(t) && /\b(bisa|agar|supaya|custom|input|form|fitur|halaman|page|budget|dropdown)\b/.test(t)) ||
    (/\b(bisa di custom|bukan hanya dropdown|input budget custom)\b/.test(t))

  const wantsAsk =
    /\b(cek|periksa|lihat|status|apa|apakah|kenapa|mengapa|bagaimana|jelaskan|ringkas|info|daftar|list|berapa|sudah|belum|bisakah|tolong bilang|mana|dimana)\b/.test(
      t
    )

  if (wantsAsk && !wantsMutate && task.length < 320) {
    if (/\b(status|deploy|vercel|online|hosting|url|alamat|link|terhubung|connected|akun|login|error|log)\b/.test(t)) {
      return 'status'
    }
    return 'ask'
  }

  if (/\b(hapus|bersihkan|buang).*(sampah|junk|output-|file)\b/.test(t) || /\bbersihkan repo\b/.test(t)) return 'cleanup'
  if (/\bhapus semua file\b/.test(t) || /\bdelete all\b/.test(t)) return 'delete'

  if (/\b(perbaiki|perbaikan|memperbaiki|fix|bug|debug|rusak|gagal|function_invocation|500|404|tidak sesuai)\b/.test(t)) {
    return 'fix'
  }

  if (/\b(deploy|publish|online-kan)\b/.test(t) && (wantsMutate || !wantsAsk)) return 'deploy'

  if (/\b(buat|bikin|buatkan|tulis|implement|kodekan|generate|scaffold|tambahkan|membangun)\b/.test(t)) {
    return 'build'
  }

  if (task.length > 350 && !wantsAsk) return 'build'
  if (task.length > 500) return 'build'
  if (t.length < 100 && wantsAsk && !wantsMutate) return 'ask'

  return wantsMutate ? 'build' : 'ask'
}

export function isChatOnlyTask(task: string): boolean {
  const intent = classifyTaskIntent(task)
  return intent === 'ask' || intent === 'status'
}

const INTENT_SYSTEM = `Kamu memahami perintah user seperti ChatGPT/Grok untuk Virtual Office.
Balas PERSIS 1 kata (huruf kecil):
ask | status | cleanup | build | fix | deploy | delete

- ask = tanya penjelasan singkat, tidak ubah file
- status = cek status/URL/deploy/koneksi saja
- cleanup = hapus file sampah
- build = buat/implementasi aplikasi atau spek/PRD
- fix = perbaiki agar sesuai yang diminta / bug
- deploy = deploy/publish
- delete = hapus banyak file

Aturan:
- "mana URL vercel" / "alamat deploy" → status
- "tidak sesuai permintaan" + perbaiki → fix
- SPEK panjang (role, schema, endpoint) → build
- Jangan ask jika user minta hasil kerja nyata

Satu kata saja.`

export async function classifyTaskIntentWithLLM(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model' | 'apiKey2' | 'baseUrl2' | 'model2'>,
  task: string
): Promise<TaskIntent> {
  const fallback = classifyTaskIntent(task)

  if (looksLikeProjectSpec(task)) return 'build'
  if (looksLikeStatusQuestion(task) && fallback === 'status') return 'status'

  if (!config?.apiKey?.trim()) return fallback

  try {
    const raw = await callLLM(
      config as AppConfig,
      INTENT_SYSTEM,
      `Perintah (${task.length} karakter):\n${task.slice(0, 1000)}\n\nNiat (1 kata):`,
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

    if ((intent === 'ask' || intent === 'status') && looksLikeProjectSpec(task)) return 'build'
    if (intent === 'build' && looksLikeStatusQuestion(task) && task.length < 280) return 'status'
    return intent
  } catch {
    return fallback
  }
}

export function isChatOnlyIntent(intent: TaskIntent): boolean {
  return intent === 'ask' || intent === 'status'
}
