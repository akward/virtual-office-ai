/** Agent memory + intent helpers */
import type { AgentMemory } from './types'

export function loadMemory(): AgentMemory {
  if (typeof localStorage === 'undefined') return { lessons: [], prefs: [] }
  try {
    const raw = localStorage.getItem('vo_agent_memory')
    if (!raw) return { lessons: [], prefs: [] }
    const parsed = JSON.parse(raw)
    return {
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.slice(-40) : [],
      prefs: Array.isArray(parsed.prefs) ? parsed.prefs.slice(-30) : [],
    }
  } catch {
    return { lessons: [], prefs: [] }
  }
}

export function saveMemory(m: AgentMemory) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem('vo_agent_memory', JSON.stringify({
    lessons: m.lessons.slice(-40),
    prefs: m.prefs.slice(-30),
  }))
}

export function memoryBlock(m: AgentMemory): string {
  const lines: string[] = []
  if (m.prefs.length) lines.push('Preferensi user:\n- ' + m.prefs.join('\n- '))
  if (m.lessons.length) {
    lines.push('Pelajaran dari koreksi user:')
    for (const L of m.lessons.slice(-15)) lines.push('- ' + L.text)
  }
  return lines.length ? '\n\n## MEMORI AGENT (wajib diikuti)\n' + lines.join('\n') : ''
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
