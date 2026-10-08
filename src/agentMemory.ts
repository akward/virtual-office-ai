/** Agent memory + skill learning (pola oh-my-claudecode, ringan untuk browser) */
import type { AgentMemory, AgentSkill } from './types'

/** Skill bawaan hasil training dari koreksi user sebelumnya */
export const SEEDED_SKILLS: AgentSkill[] = [
  {
    id: 'no-code-dump',
    name: 'Jangan dump kode di chat',
    description: 'Hasil file hanya lewat artifact/GitHub, chat cukup status singkat',
    triggers: ['buat', 'tulis', 'kode', 'file', 'dashboard', 'aplikasi', 'html', 'css', 'js'],
    body:
      'JANGAN menampilkan blok kode panjang di chat. Output file hanya via code fence filename. Di chat cukup ringkasan 1 baris.',
    source: 'seeded',
    createdAt: 0,
  },
  {
    id: 'think-first',
    name: 'Berpikir dulu',
    description: 'Selalu rencanakan sebelum eksekusi',
    triggers: ['buat', 'hapus', 'deploy', 'ubah', 'perbaiki', 'integrasi'],
    body:
      'Sebelum bertindak: pahami tujuan user, tentukan jenis tugas, daftar file yang perlu disentuh, risiko. Baru eksekusi. Jangan mengarang file yang tidak diminta.',
    source: 'seeded',
    createdAt: 0,
  },
  {
    id: 'complete-usable',
    name: 'Hasil siap pakai',
    description: 'Aplikasi harus lengkap dan bisa dipakai langsung',
    triggers: ['dashboard', 'aplikasi', 'lengkap', 'login', 'database', 'online'],
    body:
      'Hasil harus siap digunakan: index.html + styles.css + app.js (+ README singkat). Hindari file output-*.txt/sh sampah.',
    source: 'seeded',
    createdAt: 0,
  },
  {
    id: 'junk-cleanup',
    name: 'Bersihkan file sampah',
    description: 'Hapus output-* dan file sementara, jangan sentuh file inti',
    triggers: ['sampah', 'junk', 'bersihkan', 'cleanup', 'hapus output'],
    body:
      'Hapus hanya file sampah: output-*, app-2.js, app-3.js. JANGAN hapus index.html, styles.css, app.js, README.md kecuali user minta.',
    source: 'seeded',
    createdAt: 0,
  },
  {
    id: 'follow-command-exactly',
    name: 'Ikuti perintah persis',
    description: 'Jangan kerjakan tugas lain di luar permintaan',
    triggers: ['hapus', 'hanya', 'jangan', 'stop', 'batal'],
    body:
      'Kerjakan HANYA yang diminta. Jika user minta hapus, jangan update file lain.',
    source: 'seeded',
    createdAt: 0,
  },
]

function normalizeMemory(parsed: Partial<AgentMemory> | null): AgentMemory {
  const lessons = Array.isArray(parsed?.lessons) ? parsed!.lessons.slice(-40) : []
  const prefs = Array.isArray(parsed?.prefs) ? parsed!.prefs.slice(-30) : []
  let skills = Array.isArray(parsed?.skills) ? parsed!.skills.slice(-50) : []
  const byId = new Map(skills.map((s) => [s.id, s]))
  for (const s of SEEDED_SKILLS) {
    if (!byId.has(s.id)) byId.set(s.id, s)
  }
  skills = Array.from(byId.values()).slice(-50)
  return { lessons, prefs, skills }
}

export function loadMemory(): AgentMemory {
  if (typeof localStorage === 'undefined') return normalizeMemory(null)
  try {
    const raw = localStorage.getItem('vo_agent_memory')
    if (!raw) return normalizeMemory(null)
    return normalizeMemory(JSON.parse(raw))
  } catch {
    return normalizeMemory(null)
  }
}

export function saveMemory(m: AgentMemory) {
  if (typeof localStorage === 'undefined') return
  const n = normalizeMemory(m)
  localStorage.setItem(
    'vo_agent_memory',
    JSON.stringify({
      lessons: n.lessons.slice(-40),
      prefs: n.prefs.slice(-30),
      skills: n.skills.slice(-50),
    })
  )
}

export function matchSkills(m: AgentMemory, task: string): AgentSkill[] {
  const t = task.toLowerCase()
  const hits: AgentSkill[] = []
  for (const s of m.skills || []) {
    if (!s.triggers?.length) continue
    const ok = s.triggers.some((tr) => tr.trim() && t.includes(tr.toLowerCase()))
    if (ok) hits.push(s)
  }
  return hits
    .sort((a, b) => {
      const rank = (x: AgentSkill) => (x.source === 'manual' ? 0 : x.source === 'extracted' ? 1 : 2)
      return rank(a) - rank(b)
    })
    .slice(0, 6)
}

export function memoryBlock(m: AgentMemory, task?: string): string {
  const lines: string[] = []
  if (m.prefs.length) lines.push('Preferensi user:\n- ' + m.prefs.join('\n- '))
  if (m.lessons.length) {
    lines.push('Pelajaran dari koreksi user:')
    for (const L of m.lessons.slice(-12)) lines.push('- ' + L.text)
  }
  const skills = task ? matchSkills(m, task) : (m.skills || []).slice(0, 4)
  if (skills.length) {
    lines.push('SKILL AKTIF (wajib diikuti):')
    for (const s of skills) lines.push(`### ${s.name}\n${s.body}`)
  }
  return lines.length ? '\n\n## MEMORI & SKILL AGENT (wajib diikuti)\n' + lines.join('\n') : ''
}

export function detectTeachIntent(task: string): string | null {
  const t = task.trim()
  const patterns = [
    /^(?:ingat(?:kan)?(?: bahwa| ya)?[:\s]+)(.+)/i,
    /^(?:pelajari|belajar)[:\s]+(.+)/i,
    /^(?:jangan(?: pernah)? lagi[:\s]+)(.+)/i,
    /^(?:preferensi|preference)[:\s]+(.+)/i,
    /^(?:selalu[:\s]+)(.+)/i,
    /^(?:ajar(?:i|kan)? agent[:\s]+)(.+)/i,
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return null
}

export type SkillCommand =
  | { type: 'list' }
  | { type: 'remove'; query: string }
  | { type: 'skillify' }
  | { type: 'add'; name: string; body: string }
  | null

export function detectSkillCommand(task: string): SkillCommand {
  const t = task.trim()
  if (/^(?:skill\s+list|daftar\s+skill|list\s+skill|\/skill\s+list)/i.test(t)) return { type: 'list' }
  const rm = t.match(/^(?:skill\s+(?:hapus|remove|delete|rm)|\/skill\s+(?:remove|rm))\s+(.+)/i)
  if (rm?.[1]?.trim()) return { type: 'remove', query: rm[1].trim() }
  if (/^(?:skillify|\/skillify|ekstrak\s+skill)/i.test(t)) return { type: 'skillify' }
  const add = t.match(/^(?:skill\s+tambah|\/skill\s+add)\s+([^:]+):\s*(.+)/i)
  if (add?.[1]?.trim() && add[2]?.trim()) return { type: 'add', name: add[1].trim(), body: add[2].trim() }
  return null
}

export function parseSkillFromLLM(text: string): AgentSkill | null {
  try {
    const m = text.match(/\{[\s\S]*"name"[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    if (!j.name || !j.body) return null
    const triggers = Array.isArray(j.triggers)
      ? j.triggers.map((x: unknown) => String(x)).filter(Boolean).slice(0, 12)
      : String(j.triggers || '')
          .split(/[,|]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 12)
    return {
      id: 'sk-' + crypto.randomUUID().slice(0, 8),
      name: String(j.name).slice(0, 80),
      description: String(j.description || j.name).slice(0, 160),
      triggers: triggers.length ? triggers : [String(j.name).toLowerCase().slice(0, 20)],
      body: String(j.body).slice(0, 800),
      source: 'extracted',
      createdAt: Date.now(),
      hits: 0,
    }
  } catch {
    return null
  }
}

export function isJunkPath(path: string): boolean {
  const base = path.split('/').pop() || path
  if (/^output[-_]/i.test(base)) return true
  if (/^app-\d+\./i.test(base)) return true
  if (/\.dockerfi$/i.test(base)) return true
  if (/^(coder|writer|manager|researcher|security)-\d+\./i.test(base)) return true
  return false
}

export function detectJunkCleanup(task: string): boolean {
  const t = task.toLowerCase().replace(/\s+/g, ' ')
  return [
    /hapus\s+file\s+sampah/, /hapus\s+sampah/, /bersihkan\s+file/, /cleanup/,
    /hapus\s+output/, /delete\s+junk/, /remove\s+junk/, /hapus\s+file\s+tidak\s+penting/,
    /hapus\s+file\s+sementara/, /bersihkan\s+sampah/,
  ].some((p) => p.test(t))
}

export function detectDeployIntent(task: string): boolean {
  const t = task.toLowerCase()
  return /deploy.*vercel|vercel.*deploy|deploy.*online|hosting.*vercel|publikasi.*online|deploy ke vercel/.test(t)
}

export function detectBulkDeleteAll(task: string): boolean {
  const t = task.toLowerCase().replace(/\s+/g, ' ')
  return [/hapus\s+semua/, /delete\s+all/, /kosongkan\s+repo/, /wipe\s+repo/, /clear\s+repo/, /hapus\s+semua\s+file/].some((p) => p.test(t))
}
