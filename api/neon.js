/** Vercel serverless — proxy Neon API + SQL (hindari CORS dari browser) */

const NEON_API = 'https://console.neon.tech/api/v2'

async function neonGet(path, apiKey) {
  const r = await fetch(`${NEON_API}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }
  }
  body = body || {}

  const action = body.action || 'createProject'

  // SQL tidak butuh Neon API key — cukup connection string
  if (action === 'runSql') {
    const connectionUri = String(body.connectionUri || body.uri || '').trim()
    const sql = String(body.sql || body.query || '').trim()
    if (!connectionUri || !sql) {
      return res.status(400).json({ error: 'connectionUri dan sql wajib' })
    }
    let host = ''
    try {
      host = new URL(connectionUri.replace(/^postgres(ql)?:/, 'https:')).hostname
    } catch {
      return res.status(400).json({ error: 'Connection URI tidak valid' })
    }
    try {
      const r = await fetch(`https://${host}/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Neon-Connection-String': connectionUri,
        },
        body: JSON.stringify({ query: sql, params: body.params || [] }),
      })
      const text = await r.text()
      let data = {}
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text.slice(0, 500) }
      }
      if (!r.ok) {
        return res.status(r.status).json({
          error: data.message || data.error || `SQL HTTP ${r.status}`,
          detail: data,
        })
      }
      return res.status(200).json(data)
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const apiKey = String(body.apiKey || '').trim()
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey required' })
  }

  try {
    if (action === 'createProject') {
      const rawName = String(body.name || 'vo-db')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
      const name = rawName || 'vo-db'

      const projectBody = {
        project: {
          name,
          region_id: body.regionId || 'aws-ap-southeast-1',
          pg_version: body.pgVersion || 16,
        },
      }
      if (body.databaseName) {
        projectBody.project.branch = {
          database_name: body.databaseName,
          role_name: 'app_owner',
        }
      }

      const r = await fetch(`${NEON_API}/projects`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectBody),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        return res.status(r.status).json({
          error: data.message || data.error || `Neon ${r.status}`,
          detail: data,
        })
      }
      return res.status(201).json(data)
    }

    if (action === 'listProjects') {
      const r = await neonGet('/projects?limit=50', apiKey)
      if (!r.ok) {
        return res.status(r.status).json({
          error: r.data.message || r.data.error || `Neon ${r.status}`,
        })
      }
      return res.status(200).json(r.data)
    }

    if (action === 'getConnectionUri') {
      let projectId = String(body.projectId || '').trim()
      const projectName = String(body.projectName || body.name || '').trim().toLowerCase()

      if (!projectId) {
        const list = await neonGet('/projects?limit=50', apiKey)
        if (!list.ok) {
          return res.status(list.status).json({
            error: list.data.message || list.data.error || 'Gagal list project',
          })
        }
        const projects = list.data.projects || []
        const found = projectName
          ? projects.find((p) => String(p.name || '').toLowerCase() === projectName) ||
            projects.find((p) => String(p.name || '').toLowerCase().includes(projectName))
          : projects[0]
        if (!found) {
          return res.status(404).json({
            error: projectName
              ? `Project «${projectName}» tidak ditemukan`
              : 'Tidak ada project Neon',
            projects: projects.map((p) => ({ id: p.id, name: p.name })),
          })
        }
        projectId = found.id
      }

      const branches = await neonGet(`/projects/${projectId}/branches`, apiKey)
      if (!branches.ok) {
        return res.status(branches.status).json({
          error: branches.data.message || 'Gagal ambil branches',
        })
      }
      const branchList = branches.data.branches || []
      const branch =
        branchList.find((b) => b.default || b.primary) || branchList[0]
      if (!branch) {
        return res.status(404).json({ error: 'Branch tidak ditemukan' })
      }

      const dbs = await neonGet(
        `/projects/${projectId}/branches/${branch.id}/databases`,
        apiKey
      )
      const roles = await neonGet(
        `/projects/${projectId}/branches/${branch.id}/roles`,
        apiKey
      )
      const dbName =
        body.databaseName ||
        (dbs.data.databases && dbs.data.databases[0] && dbs.data.databases[0].name) ||
        'neondb'
      const roleName =
        body.roleName ||
        (roles.data.roles && roles.data.roles[0] && roles.data.roles[0].name) ||
        'neondb_owner'

      const q = new URLSearchParams({
        database_name: dbName,
        role_name: roleName,
      })
      if (branch.id) q.set('branch_id', branch.id)

      const uriRes = await neonGet(
        `/projects/${projectId}/connection_uri?${q.toString()}`,
        apiKey
      )
      if (!uriRes.ok) {
        return res.status(uriRes.status).json({
          error:
            uriRes.data.message ||
            uriRes.data.error ||
            `Gagal ambil connection URI (${uriRes.status})`,
          detail: uriRes.data,
        })
      }

      const connectionUri =
        uriRes.data.uri ||
        uriRes.data.connection_uri ||
        (uriRes.data.connection_uris &&
          uriRes.data.connection_uris[0] &&
          uriRes.data.connection_uris[0].connection_uri) ||
        ''

      if (!connectionUri) {
        return res.status(500).json({
          error: 'URI kosong dari Neon API',
          detail: uriRes.data,
        })
      }

      return res.status(200).json({
        projectId,
        projectName: body.projectName || projectName || projectId,
        branchId: branch.id,
        branchName: branch.name,
        databaseName: dbName,
        roleName,
        connectionUri,
      })
    }

    return res.status(400).json({ error: 'Unknown action: ' + action })
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
