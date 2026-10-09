/** Roster agent Virtual Office — 19 spesialis (pola oh-my-claudecode, ringan di browser) */
import type { Agent } from './types'

export type WorkerSpec = {
  id: string
  name: string
  system: string
}

function pos(col: number, row: number): { x: number; y: number } {
  return { x: 8 + col * 18, y: 12 + row * 20 }
}

export const defaultAgents: Agent[] = [
  { id: 'manager', name: 'Budi', role: 'Project Manager', color: '#3b82f6', emoji: '👔', status: 'idle', currentTask: '', lastMessage: 'Siap!', ...pos(0, 0) },
  { id: 'planner', name: 'Dewi', role: 'Planner', color: '#0ea5e9', emoji: '📋', status: 'idle', currentTask: '', lastMessage: 'Rencana siap', ...pos(1, 0) },
  { id: 'architect', name: 'Raka', role: 'Architect', color: '#6366f1', emoji: '🏗️', status: 'idle', currentTask: '', lastMessage: 'Desain sistem', ...pos(2, 0) },
  { id: 'critic', name: 'Maya', role: 'Critic', color: '#78716c', emoji: '⚖️', status: 'idle', currentTask: '', lastMessage: 'Siap kritik', ...pos(3, 0) },
  { id: 'verifier', name: 'Yoga', role: 'Verifier', color: '#64748b', emoji: '✅', status: 'idle', currentTask: '', lastMessage: 'Cek hasil', ...pos(4, 0) },
  { id: 'coder', name: 'Andi', role: 'Executor / Engineer', color: '#22c55e', emoji: '💻', status: 'idle', currentTask: '', lastMessage: 'Siap!', ...pos(0, 1) },
  { id: 'simplifier', name: 'Nia', role: 'Code Simplifier', color: '#84cc16', emoji: '✨', status: 'idle', currentTask: '', lastMessage: 'Rapikan kode', ...pos(1, 1) },
  { id: 'reviewer', name: 'Fajar', role: 'Code Reviewer', color: '#14b8a6', emoji: '🔎', status: 'idle', currentTask: '', lastMessage: 'Review', ...pos(2, 1) },
  { id: 'debugger', name: 'Gilang', role: 'Debugger', color: '#f97316', emoji: '🐛', status: 'idle', currentTask: '', lastMessage: 'Trace bug', ...pos(3, 1) },
  { id: 'gitmaster', name: 'Hana', role: 'Git Master', color: '#a16207', emoji: '🌿', status: 'idle', currentTask: '', lastMessage: 'Repo rapi', ...pos(4, 1) },
  { id: 'researcher', name: 'Siti', role: 'Explorer / Research', color: '#a855f7', emoji: '🔍', status: 'idle', currentTask: '', lastMessage: 'Siap!', ...pos(0, 2) },
  { id: 'designer', name: 'Luna', role: 'Designer', color: '#ec4899', emoji: '🎨', status: 'idle', currentTask: '', lastMessage: 'UI/UX', ...pos(1, 2) },
  { id: 'qa', name: 'Eka', role: 'QA Tester', color: '#eab308', emoji: '🧪', status: 'idle', currentTask: '', lastMessage: 'Uji', ...pos(2, 2) },
  { id: 'tester', name: 'Tomi', role: 'Test Engineer', color: '#ca8a04', emoji: '🧰', status: 'idle', currentTask: '', lastMessage: 'Test case', ...pos(3, 2) },
  { id: 'security', name: 'Doni', role: 'Security Reviewer', color: '#ef4444', emoji: '🛡️', status: 'idle', currentTask: '', lastMessage: 'Siap amankan!', ...pos(4, 2) },
  { id: 'writer', name: 'Rina', role: 'Writer / Docs', color: '#f59e0b', emoji: '✍️', status: 'idle', currentTask: '', lastMessage: 'Siap!', ...pos(0, 3) },
  { id: 'docs', name: 'Putri', role: 'Document Specialist', color: '#d97706', emoji: '📄', status: 'idle', currentTask: '', lastMessage: 'Docs', ...pos(1, 3) },
  { id: 'analyst', name: 'Bima', role: 'Analyst', color: '#06b6d4', emoji: '📊', status: 'idle', currentTask: '', lastMessage: 'Analisis', ...pos(2, 3) },
  { id: 'tracer', name: 'Sari', role: 'Tracer', color: '#8b5cf6', emoji: '🧭', status: 'idle', currentTask: '', lastMessage: 'Lacak alur', ...pos(3, 3) },
]

const RULE =
  ' Bahasa Indonesia. JANGAN echo instruksi sistem. JANGAN tulis "thinking process". JANGAN ulangi "Max N baris". Jawab langsung isi saja.'

const SYSTEMS: Record<string, string> = {
  manager: 'Kamu Budi, PM.' + RULE + ' Koordinasi singkat. Jangan dump kode panjang di chat.',
  planner: 'Kamu Dewi, Planner.' + RULE + ' Output singkat: langkah 1..n dan file yang disentuh. Tanpa kode panjang.',
  architect: 'Kamu Raka, Architect.' + RULE + ' Usulkan struktur file/modul singkat. File pakai fence ```lang:path.',
  critic: 'Kamu Maya, Critic.' + RULE + ' Kritik risiko/missing piece. Maks 8 baris.',
  verifier: 'Kamu Yoga, Verifier.' + RULE + ' Cek apakah hasil memenuhi tugas. List lulus/gagal singkat.',
  coder:
    'Kamu Andi, Engineer.' + RULE +
    ' Jika tugas MEMBUAT/EDIT kode: output HANYA fence ```lang:path (contoh ```html:index.html). Jika tugas hanya tanya/cek status: jawab teks singkat TANPA file.',
  simplifier: 'Kamu Nia, Simplifier.' + RULE + ' Sederhanakan kode. Fence file hanya jika ada perubahan nyata.',
  reviewer: 'Kamu Fajar, Reviewer.' + RULE + ' Temukan bug/smell. Maks 10 baris.',
  debugger: 'Kamu Gilang, Debugger.' + RULE + ' Diagnosa error + patch. Fence file jika perlu.',
  gitmaster: 'Kamu Hana, Git Master.' + RULE + ' Saran commit/branch/repo. Jangan dump diff panjang.',
  researcher: 'Kamu Siti, Explorer.' + RULE + ' Ringkas temuan. Maks 12 baris. Jangan buat file kecuali diminta.',
  designer: 'Kamu Luna, Designer.' + RULE + ' UI/UX. Jika buat UI: ```html:index.html dan/atau ```css:styles.css.',
  qa: 'Kamu Eka, QA.' + RULE + ' Checklist uji singkat. Tanpa file kecuali diminta.',
  tester: 'Kamu Tomi, Test Engineer.' + RULE + ' Test case singkat. Fence file hanya jika diminta.',
  security: 'Kamu Doni, Security.' + RULE + ' Audit XSS/auth/secret. Temuan + mitigasi singkat.',
  writer: 'Kamu Rina, Writer.' + RULE + ' Jika diminta docs: ```md:README.md. Jika tanya saja: jawab teks tanpa file.',
  docs: 'Kamu Putri, Docs.' + RULE + ' Dokumentasi singkat. Fence ```md: hanya jika diminta tulis docs.',
  analyst: 'Kamu Bima, Analyst.' + RULE + ' Analisis singkat. Tanpa kode kecuali diminta.',
  tracer: 'Kamu Sari, Tracer.' + RULE + ' Lacak alur. Diagram teks singkat.',
}

/** Apakah tugas hanya tanya/cek status (bukan buat file)? */
export function isChatOnlyTask(task: string): boolean {
  const t = task.toLowerCase().trim()
  if (/buat|bikin|tulis|implement|kodekan|generate|scaffold|deploy|hapus file|push|commit/.test(t)) return false
  if (/^(apa|apakah|kenapa|mengapa|bagaimana|coba|cek|test|tolong|jelaskan|ringkas)/.test(t)) return true
  if (/\?$/.test(t)) return true
  if (/sudah bisa|bisa masuk|status|terhubung|connected|akun/.test(t) && !/buat|bikin|implement/.test(t)) return true
  return false
}

export function pickWorkers(task: string, powerMode: boolean): WorkerSpec[] {
  const t = task.toLowerCase()
  const out: WorkerSpec[] = []
  const add = (id: string) => {
    const a = defaultAgents.find((x) => x.id === id)
    if (!a || out.some((w) => w.id === id)) return
    out.push({ id, name: a.name, system: SYSTEMS[id] || `Kamu ${a.name}, ${a.role}.` + RULE })
  }

  if (isChatOnlyTask(task)) {
    add('researcher')
    if (powerMode) add('analyst')
    return out.slice(0, 2)
  }

  const isBuild = /buat|bikin|tulis|implement|dashboard|aplikasi|app|website|halaman|fitur|kode|html|css|js|react/.test(t)
  const isFix = /perbaiki|fix|bug|error|debug|rusak|gagal/.test(t)
  const isReview = /review|audit|cek kode|code review/.test(t)
  const isSecure = /keamanan|security|xss|auth|password|token secret|hardening/.test(t)
  const isUi = /ui|ux|desain|tampilan|css|style|warna/.test(t)
  const isDocs = /dokumentasi|readme|docs|panduan/.test(t)
  const isData = /analisis|data|laporan|metrik|chart|statistik/.test(t)
  const isQa = /\b(test case|uji|qa|checklist)\b/.test(t)
  const isArch = /arsitektur|struktur|arsitek|scalable|modul/.test(t)
  const isExplore = /cari|telusuri|explore|bagaimana|dimana|repo/.test(t)

  if (isArch) add('architect')
  if (isExplore) add('researcher')
  if (isBuild || isFix) add('coder')
  if (isUi) add('designer')
  if (isFix) add('debugger')
  if (isReview) add('reviewer')
  if (isSecure) add('security')
  if (isDocs || isBuild) add('writer')
  if (isDocs) add('docs')
  if (isQa) add('qa')
  if (isData) add('analyst')
  if (isFix && powerMode) add('tracer')
  if (powerMode && isBuild) add('simplifier')

  if (!out.length) {
    add('researcher')
    add('analyst')
  }

  const max = powerMode ? 6 : 4
  return out.slice(0, max)
}

export function agentById(id: string): Agent | undefined {
  return defaultAgents.find((a) => a.id === id)
}

export { SYSTEMS }
