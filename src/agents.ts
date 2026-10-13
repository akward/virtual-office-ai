/** Roster agent Virtual Office — 19 spesialis (pola oh-my-claudecode, ringan di browser) */
import type { Agent } from './types'
import { classifyTaskIntent, isChatOnlyTask } from './taskIntent'
export { classifyTaskIntent, isChatOnlyTask }

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
  ' Bahasa Indonesia. Langsung hasil. ' +
  'Pahami NIAT user: cek/status/tanya → jawab saja, JANGAN ubah file. Jangan ganti dashboard jadi Deploy Status Checker. ' +
  'LARANGAN KERAS: jangan tool_call, jangan <|tool, jangan JSON {"tool":...}, jangan path /home/, jangan bash/ls/cat, jangan "User Safety". ' +
  'Kamu TIDAK punya terminal dan TIDAK punya tool — hanya tulis teks/file. ' +
  'File produksi HANYA lewat fence: ```html:index.html  ```css:styles.css  ```js:app.js  ```js:api/xxx.js  ```md:README.md  ```json:package.json  ```json:vercel.json. ' +
  'JANGAN output-*, app-2.js, *.sh, *.prisma, pages/, src/Dashboard.jsx palsu. ' +
  'Database: api/ + Neon, bukan localStorage. Jangan thinking process.'

const SYSTEMS: Record<string, string> = {
  manager: 'Kamu Budi, PM.' + RULE + ' Koordinasi singkat 3-5 baris. Jangan dump kode. Jangan tool. Jika user hanya cek status, jawab status saja.',
  planner: 'Kamu Dewi, Planner.' + RULE + ' Langkah 1..n + nama file saja. Tanpa kode. Tanpa tool.',
  architect: 'Kamu Raka, Architect.' + RULE + ' Struktur file singkat. File pakai fence ```lang:path.',
  critic: 'Kamu Maya, Critic.' + RULE + ' Kritik singkat maks 8 baris. Tanpa tool.',
  verifier: 'Kamu Yoga, Verifier.' + RULE + ' Lulus/gagal singkat. Tanpa tool. Tanpa path fiktif.',
  coder:
    'Kamu Andi, Engineer.' + RULE +
    ' WAJIB output file lengkap di fence ```lang:path jika tugas buat/perbaiki/deploy. ' +
    'Minimal index.html + styles.css + app.js jika dashboard. Jangan narasi panjang. Jangan tool.',
  simplifier: 'Kamu Nia, Simplifier.' + RULE + ' Fence file hanya jika ada perubahan nyata. Tanpa tool.',
  reviewer: 'Kamu Fajar, Reviewer.' + RULE + ' Bug/smell maks 10 baris. Tanpa tool.',
  debugger: 'Kamu Gilang, Debugger.' + RULE + ' Patch via fence file. Tanpa tool/bash.',
  gitmaster: 'Kamu Hana, Git Master.' + RULE + ' Saran commit singkat. Push dilakukan sistem, bukan kamu.',
  researcher: 'Kamu Siti, Explorer.' + RULE + ' Temuan singkat. Tanpa tool. Tanpa file kecuali diminta.',
  designer: 'Kamu Luna, Designer.' + RULE + ' UI: wajib ```html:index.html dan/atau ```css:styles.css lengkap.',
  qa: 'Kamu Eka, QA.' + RULE + ' Checklist singkat. Tanpa tool.',
  tester: 'Kamu Tomi, Test Engineer.' + RULE + ' Test case singkat. Tanpa tool.',
  security: 'Kamu Doni, Security.' + RULE + ' Temuan + mitigasi singkat. Tanpa tool. Jangan tulis User Safety.',
  writer: 'Kamu Rina, Writer.' + RULE + ' Docs: ```md:README.md jika diminta. Tanpa tool.',
  docs: 'Kamu Putri, Docs.' + RULE + ' Fence ```md: hanya jika diminta.',
  analyst: 'Kamu Bima, Analyst.' + RULE + ' Analisis singkat. Tanpa tool.',
  tracer: 'Kamu Sari, Tracer.' + RULE + ' Alur singkat. Tanpa tool.',
}

export function pickWorkers(task: string, powerMode: boolean): WorkerSpec[] {
  const t = task.toLowerCase()
  const out: WorkerSpec[] = []
  const add = (id: string) => {
    const a = defaultAgents.find((x) => x.id === id)
    if (!a || out.some((w) => w.id === id)) return
    out.push({ id, name: a.name, system: SYSTEMS[id] || `Kamu ${a.name}, ${a.role}.` + RULE })
  }

  const intent = classifyTaskIntent(task)
  if (intent === 'ask' || intent === 'status' || isChatOnlyTask(task)) {
    return []
  }

  const isBuild = intent === 'build' || /buat|bikin|tulis|implement|dashboard|aplikasi|app|website|halaman|fitur|kode|html|css|js|react|database|neon|api/.test(t)
  const isFix = intent === 'fix' || /perbaiki|fix|bug|error|debug|rusak|gagal/.test(t)
  const isDeploy = intent === 'deploy' || (/\b(deploy|publish|online-kan)\b/.test(t) && intent !== 'status')
  const isReview = /review|audit|cek kode|code review/.test(t)
  const isSecure = /keamanan|security|xss|auth|password|token secret|hardening|login/.test(t)
  const isUi = /ui|ux|desain|tampilan|css|style|warna|dashboard/.test(t)
  const isDocs = /dokumentasi|readme|docs|panduan/.test(t)
  const isData = /analisis|data|laporan|metrik|chart|statistik|database|neon/.test(t)
  const isQa = /\b(test case|uji|qa|checklist)\b/.test(t)
  const isArch = /arsitektur|struktur|arsitek|scalable|modul/.test(t)
  const isExplore = /cari|telusuri|explore|bagaimana|dimana|repo/.test(t)
  const fullAuto = /otomatis|full|semua agent|tanpa campur|selesaikan/.test(t) || powerMode

  if (isFix && (isBuild || isDeploy || isUi)) {
    add('coder')
    add('designer')
    add('debugger')
    if (isSecure) add('security')
  } else if (isBuild || fullAuto || isDeploy) {
    add('planner')
    add('coder')
    add('designer')
    if (isSecure || /login|auth|database/.test(t) || fullAuto) add('security')
    if (isDocs || isBuild) add('writer')
  } else {
    if (isArch) add('architect')
    if (isExplore) add('researcher')
    if (isFix) {
      add('debugger')
      add('coder')
    }
    if (isUi) add('designer')
    if (isReview) add('reviewer')
    if (isSecure) add('security')
    if (isDocs) add('writer')
    if (isData) add('analyst')
    if (isQa) add('qa')
  }

  if (!out.length) add('coder')

  const max = fullAuto || powerMode ? 5 : 4
  return out.slice(0, max)
}

export function agentById(id: string): Agent | undefined {
  return defaultAgents.find((a) => a.id === id)
}

export { SYSTEMS }
