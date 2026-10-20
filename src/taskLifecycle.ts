/** Alur tugas: konfirmasi rencana, checklist selesai, ringkasan 5 baris */

import type { TaskIntent } from './taskIntent'
import { verifyLiveUrl, type VerifyResult } from './verifyDeploy'

export type PendingPlan = {
  task: string
  plan: string
  thought: string
  intent: TaskIntent
  power: boolean
  tok: number
  pace: number
  richContext: string
  mem: string
}

export type ChecklistItem = {
  name: string
  ok: boolean
  detail: string
}

/** Deteksi perintah konfirmasi / batal / revisi saat ada rencana tertunda */
export function parsePlanReply(text: string):
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'revise'; note: string }
  | { kind: 'other' } {
  const t = text.trim()
  const low = t.toLowerCase()
  if (/^(batal|cancel|stop|tidak|ga|gak)(\s|$)/i.test(low) || low === 'n') return { kind: 'cancel' }
  if (
    /^(lanjut|ya|y|ok|oke|setuju|gas|go|jalankan|execute|run|sip|baik)(\s|[!.]|$)/i.test(low) ||
    /^(lanjutkan|kerjakan|yes)\b/i.test(low)
  ) {
    return { kind: 'confirm' }
  }
  const m = t.match(/^(ubah|revisi|ganti|edit)\s*[:\-]?\s*(.+)$/is)
  if (m) return { kind: 'revise', note: m[2].trim() }
  return { kind: 'other' }
}

export function wantsSkipConfirm(task: string, powerMode: boolean): boolean {
  if (/langsung kerjakan|tanpa konfirmasi|skip confirm|auto-?run|full auto tanpa tanya/i.test(task)) return true
  // power mode tetap konfirmasi kecuali user bilang langsung
  return false
}

export function formatPlanPrompt(plan: string, intent: TaskIntent): string {
  return (
    `## Rencana (${intent})\n` +
    `${plan.trim() || '1. Kerjakan sesuai perintah user'}\n\n` +
    `Balas:\n` +
    `• **lanjut** / **ya** — eksekusi\n` +
    `• **ubah: …** — revisi rencana\n` +
    `• **batal** — batalkan\n` +
    `(atau tombol di bawah chat)`
  )
}

export async function runCompletionChecklist(opts: {
  fileNames: string[]
  deployUrl?: string
  task: string
}): Promise<ChecklistItem[]> {
  const items: ChecklistItem[] = []
  items.push({
    name: 'File produksi',
    ok: opts.fileNames.length > 0,
    detail: opts.fileNames.length ? opts.fileNames.slice(0, 12).join(', ') : 'tidak ada file di-push',
  })

  if (opts.deployUrl) {
    try {
      const v: VerifyResult = await verifyLiveUrl(opts.deployUrl)
      const ok = v.ok || v.status === 200
      items.push({
        name: 'Deploy live',
        ok,
        detail: ok
          ? `HTTP ${v.status} · ${opts.deployUrl}`
          : `HTTP ${v.status} · ${(v.issues[0] || 'gagal').slice(0, 120)}`,
      })
    } catch (e: unknown) {
      items.push({
        name: 'Deploy live',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  } else if (/\b(deploy|vercel|online|publish)\b/i.test(opts.task)) {
    items.push({ name: 'Deploy live', ok: false, detail: 'URL deploy tidak tersedia' })
  }

  // Soft checks — dokumentasikan saja
  if (/\b(login|auth|user)\b/i.test(opts.task)) {
    items.push({
      name: 'Login / auth',
      ok: opts.fileNames.some((f) => /auth|login|app\.js|index\.html/i.test(f)),
      detail: 'cek manual di URL live jika deploy OK',
    })
  }
  if (/\b(neon|database|postgres|db)\b/i.test(opts.task)) {
    items.push({
      name: 'Database',
      ok: opts.fileNames.some((f) => /api\/|schema|prisma|\.sql/i.test(f)),
      detail: 'pastikan RA_DATABASE_URL / Neon di Vercel',
    })
  }

  return items
}

export function formatResultSummary(opts: {
  intent: TaskIntent
  fileNames: string[]
  deployUrl?: string
  checklist: ChecklistItem[]
}): string {
  const passed = opts.checklist.filter((c) => c.ok).length
  const total = opts.checklist.length
  const fail = opts.checklist.filter((c) => !c.ok).map((c) => c.name)
  const lines = [
    '## Ringkasan (5 baris)',
    `1. Niat: **${opts.intent}** — dikerjakan.`,
    `2. File: ${opts.fileNames.length ? opts.fileNames.slice(0, 8).join(', ') : '—'}`,
    `3. Live: ${opts.deployUrl || '—'}`,
    `4. Checklist: ${passed}/${total} OK` + (opts.checklist.length ? ` (${opts.checklist.map((c) => (c.ok ? '✓' : '✗') + c.name).join(', ')})` : ''),
    `5. Belum: ${fail.length ? fail.join(', ') : 'tidak ada — siap dicek manual'}`,
  ]
  return lines.join('\n')
}
