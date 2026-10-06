/** Deploy ke Vercel (gratis) via API token user */

export async function deployToVercel(opts: {
  token: string
  name: string
  files: { path: string; content: string }[]
}): Promise<{ url: string; id: string }> {
  const token = opts.token.trim()
  if (!token) throw new Error('Vercel token kosong')
  const name =
    opts.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40) || 'vo-app'

  const files: Record<string, { data: string }> = {}
  for (const f of opts.files) {
    const p = f.path.replace(/^\/+/, '')
    if (!p || f.content == null) continue
    files[p] = { data: f.content }
  }
  if (!Object.keys(files).length) throw new Error('Tidak ada file untuk deploy')

  if (!files['index.html'] && !files['index.htm']) {
    files['index.html'] = {
      data: '<!DOCTYPE html><html><body><h1>Virtual Office AI deploy</h1></body></html>',
    }
  }

  const res = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      files,
      projectSettings: { framework: null },
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Vercel ${res.status}`)
  }
  const url = data.url ? (data.url.startsWith('http') ? data.url : `https://${data.url}`) : ''
  return { url: url || `https://${name}.vercel.app`, id: data.id || '' }
}
