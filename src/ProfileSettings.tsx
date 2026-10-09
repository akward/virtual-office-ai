/** Multi-profile Vercel + Supabase — user chooses, no forced default */
import { useState } from 'react'
import { useStore } from './store'
import {
  loadSupabaseConfig,
  saveSupabaseConfig,
  testSupabaseConnection,
  loadSbProfiles,
  upsertSbProfile,
  removeSbProfile,
  selectSbProfile,
  getActiveSbId,
  EXAMPLE_SB_PROFILES,
  loadVercelProfiles,
  upsertVercelProfile,
  removeVercelProfile,
  selectVercelProfile,
  getActiveVercelId,
} from './supabase'

export function VercelProfileSection() {
  const { config, setConfig, addMessage, saveToBackend } = useStore()
  const [vbProfiles, setVbProfiles] = useState(() => loadVercelProfiles())
  const [vbActive, setVbActive] = useState(() => getActiveVercelId())
  const [vbLabel, setVbLabel] = useState('')
  const [vbProject, setVbProject] = useState('')

  return (
    <section className="side-block">
      <h3>Vercel (pilih profil)</h3>
      <p className="help-text">Tidak ada default otomatis. Pilih atau tambah profil token + project.</p>
      <label className="field-label">Profil aktif</label>
      <select
        value={vbActive}
        onChange={(e) => {
          const id = e.target.value
          setVbActive(id)
          const p = selectVercelProfile(id)
          if (p) {
            setConfig({ vercelToken: p.token })
            setVbLabel(p.label)
            setVbProject(p.projectName || '')
          } else {
            setConfig({ vercelToken: '' })
          }
        }}
      >
        <option value="">— belum dipilih —</option>
        {vbProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.projectName ? ` (${p.projectName})` : ''}
          </option>
        ))}
      </select>
      <label className="field-label">Nama profil</label>
      <input value={vbLabel} onChange={(e) => setVbLabel(e.target.value)} placeholder="mis. personal-hobby" />
      <label className="field-label">Project name (opsional)</label>
      <input value={vbProject} onChange={(e) => setVbProject(e.target.value)} placeholder="virtual-office-ai" />
      <label className="field-label">Vercel Token</label>
      <input
        type="password"
        value={config.vercelToken || ''}
        onChange={(e) => setConfig({ vercelToken: e.target.value })}
        placeholder="Token dari vercel.com/account/tokens"
      />
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            if (!config.vercelToken?.trim()) {
              addMessage('System', 'Isi Vercel token dulu')
              return
            }
            const id = vbActive || crypto.randomUUID()
            const label = vbLabel.trim() || `vercel-${(config.vercelToken || '').slice(-6)}`
            upsertVercelProfile({
              id,
              label,
              token: config.vercelToken.trim(),
              projectName: vbProject.trim() || undefined,
            })
            setVbProfiles(loadVercelProfiles())
            setVbActive(id)
            setVbLabel(label)
            addMessage('System', `Vercel profil «${label}» disimpan & dipilih.`)
            saveToBackend({ includeGithubToken: true }).catch(() => {})
          }}
        >
          💾 Simpan profil Vercel
        </button>
        {vbActive && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              removeVercelProfile(vbActive)
              setVbProfiles(loadVercelProfiles())
              const next = getActiveVercelId()
              setVbActive(next)
              setConfig({ vercelToken: selectVercelProfile(next)?.token || '' })
            }}
          >
            ✕ Hapus profil
          </button>
        )}
      </div>
    </section>
  )
}

export function SupabaseProfileSection() {
  const { addMessage, saveToBackend, loadFromBackend, isSyncingSettings } = useStore()
  const [sbUrl, setSbUrl] = useState(() => loadSupabaseConfig().url || '')
  const [sbKey, setSbKey] = useState(() => loadSupabaseConfig().anonKey || '')
  const [sbLabel, setSbLabel] = useState('')
  const [sbProfiles, setSbProfiles] = useState(() => loadSbProfiles())
  const [sbActive, setSbActive] = useState(() => getActiveSbId())
  const [sbMsg, setSbMsg] = useState('')

  return (
    <section className="side-block">
      <h3>Database Supabase (pilih project)</h3>
      <p className="help-text">Tidak default ke 1 database. Pilih project yang mau dipakai, atau isi manual.</p>
      <label className="field-label">Project aktif</label>
      <select
        value={sbActive}
        onChange={(e) => {
          const id = e.target.value
          setSbActive(id)
          if (!id) {
            setSbUrl('')
            setSbKey('')
            return
          }
          selectSbProfile(id)
          const p = loadSbProfiles().find((x) => x.id === id)
          if (p) {
            setSbUrl(p.url)
            setSbKey(p.anonKey)
            setSbLabel(p.label)
          }
        }}
      >
        <option value="">— belum dipilih —</option>
        {sbProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="help-text">Contoh cepat (opsional, tidak otomatis aktif):</p>
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
        {EXAMPLE_SB_PROFILES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSbLabel(ex.label)
              setSbUrl(ex.url)
              setSbKey(ex.anonKey)
            }}
          >
            + {ex.label}
          </button>
        ))}
      </div>
      <label className="field-label">Nama profil / project</label>
      <input value={sbLabel} onChange={(e) => setSbLabel(e.target.value)} placeholder="mis. pos-multi-toko" />
      <label className="field-label">Supabase URL</label>
      <input value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
      <label className="field-label">Anon / Publishable Key</label>
      <input
        type="password"
        value={sbKey}
        onChange={(e) => setSbKey(e.target.value)}
        placeholder="eyJ... atau sb_publishable_..."
      />
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            if (!sbUrl.trim() || !sbKey.trim()) {
              setSbMsg('Isi URL + Key')
              return
            }
            const id = sbActive || crypto.randomUUID()
            const label = sbLabel.trim() || sbUrl.replace(/^https?:\/\//, '').split('.')[0]
            upsertSbProfile({ id, label, url: sbUrl.replace(/\/$/, ''), anonKey: sbKey.trim() })
            setSbProfiles(loadSbProfiles())
            setSbActive(id)
            setSbLabel(label)
            setSbMsg(`Profil «${label}» disimpan & dipilih.`)
            saveToBackend({ includeGithubToken: true }).catch(() => {})
          }}
        >
          💾 Simpan & pilih profil
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            try {
              setSbMsg(await testSupabaseConnection({ url: sbUrl.replace(/\/$/, ''), anonKey: sbKey }))
            } catch (e: unknown) {
              setSbMsg(String(e))
            }
          }}
        >
          🔌 Test
        </button>
        {sbActive && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              removeSbProfile(sbActive)
              setSbProfiles(loadSbProfiles())
              const next = getActiveSbId()
              setSbActive(next)
              const cfg = loadSupabaseConfig()
              setSbUrl(cfg.url)
              setSbKey(cfg.anonKey)
              setSbMsg('Profil dihapus.')
            }}
          >
            ✕ Hapus profil
          </button>
        )}
      </div>
      {sbMsg && <p className="help-text">{sbMsg}</p>}
      <button
        type="button"
        className="btn-ghost"
        disabled={isSyncingSettings || !sbUrl || !sbKey}
        onClick={async () => {
          saveSupabaseConfig({ url: sbUrl, anonKey: sbKey })
          try {
            await saveToBackend({ includeGithubToken: true })
          } catch (e: unknown) {
            addMessage('System', String(e))
          }
        }}
      >
        {isSyncingSettings ? 'Menyimpan...' : '☁️ Sync setting ke DB aktif'}
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={isSyncingSettings || !sbUrl || !sbKey}
        onClick={async () => {
          saveSupabaseConfig({ url: sbUrl, anonKey: sbKey })
          try {
            await loadFromBackend()
          } catch (e: unknown) {
            addMessage('System', String(e))
          }
        }}
      >
        {isSyncingSettings ? 'Memuat...' : '⬇️ Muat dari DB aktif'}
      </button>
    </section>
  )
}
