/** Vercel serverless — proxy Neon API (hindari CORS dari browser) */

const NEON_API = 'https://console.neon.tech/api/v2'

module.exports = async function handler(req, res) {
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

  const apiKey = String(body.apiKey || '').trim()
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey required' })
  }

  const action = body.action || 'createProject'

  try {
    if (action === 'createProject') {
      const name = String(body.name || 'vo-db')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'vo-db'

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
      const r = await fetch(`${NEON_API}/projects?limit=50`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        return res.status(r.status).json({
          error: data.message || data.error || `Neon ${r.status}`,
        })
      }
      return res.status(200).json(data)
    }

    return res.status(400).json({ error: 'Unknown action: ' + action })
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
