/** Deploy ke Vercel (gratis) via API token user */

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const DEPLOY_OK = /\.(html?|css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|txt|md|woff2?)$/i

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

  // Vercel API: files HARUS array [{ file, data, encoding }]
  const fileArr: { file: string; data: string; encoding: string }[] = []
  const seen = new Set<string>()

  for (const f of opts.files) {
    const p = f.path.replace(/^\/+/, '').trim()
    if (!p || f.content == null) continue
    if (/^output-/i.test(p.split('/').pop() || '')) continue
    if (p.endsWith('.sh')) continue
    if (!DEPLOY_OK.test(p) && !p.startsWith('api/')) continue
    if (seen.has(p)) continue
    seen.add(p)
    fileArr.push({ file: p, data: toBase64(f.content), encoding: 'base64' })
  }

  if (!seen.has('index.html') && !seen.has('index.htm')) {
    fileArr.push({
      file: 'index.html',
      data: toBase64(
        '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App</title><link rel="stylesheet" href="styles.css"></head><body><div id="app"></div><script src="app.js"></script></body></html>'
      ),
      encoding: 'base64',
    })
  }

  if (!fileArr.length) throw new Error('Tidak ada file valid untuk deploy')

  const res = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      files: fileArr,
      projectSettings: { framework: null },
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200)
    throw new Error(msg)
  }

  const rawUrl = data.url || data.alias?.[0] || ''
  const url = rawUrl
    ? rawUrl.startsWith('http')
      ? rawUrl
      : `https://${rawUrl}`
    : `https://${name}.vercel.app`

  return { url, id: data.id || '' }
}
