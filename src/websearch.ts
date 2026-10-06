/** Pencarian online gratis tanpa API key (DuckDuckGo + Wikipedia) */

export type SearchHit = { title: string; url: string; snippet: string; source: string }

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export async function searchWikipedia(query: string, limit = 5): Promise<SearchHit[]> {
  const url =
    'https://id.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      format: 'json',
      origin: '*',
    })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const data = await res.json()
  const items = data?.query?.search || []
  return items.map((it: { title: string; snippet: string }) => ({
    title: it.title,
    url: `https://id.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}`,
    snippet: stripHtml(it.snippet || ''),
    source: 'wikipedia',
  }))
}

export async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const url =
    'https://api.duckduckgo.com/?' +
    new URLSearchParams({
      q: query,
      format: 'json',
      no_redirect: '1',
      no_html: '1',
      skip_disambig: '1',
    })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  const data = await res.json()
  const hits: SearchHit[] = []
  if (data.AbstractText) {
    hits.push({
      title: data.Heading || query,
      url: data.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(query),
      snippet: data.AbstractText,
      source: 'duckduckgo',
    })
  }
  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []
  for (const t of related.slice(0, 8)) {
    if (t.Text && t.FirstURL) {
      hits.push({
        title: t.Text.split(' - ')[0] || t.Text.slice(0, 80),
        url: t.FirstURL,
        snippet: t.Text,
        source: 'duckduckgo',
      })
    }
    if (Array.isArray(t.Topics)) {
      for (const sub of t.Topics.slice(0, 3)) {
        if (sub.Text && sub.FirstURL) {
          hits.push({
            title: sub.Text.split(' - ')[0] || sub.Text.slice(0, 80),
            url: sub.FirstURL,
            snippet: sub.Text,
            source: 'duckduckgo',
          })
        }
      }
    }
  }
  return hits.slice(0, 10)
}

export async function searchOnline(query: string): Promise<{ text: string; hits: SearchHit[] }> {
  const hits: SearchHit[] = []
  const errors: string[] = []
  try {
    hits.push(...(await searchDuckDuckGo(query)))
  } catch (e: unknown) {
    errors.push('DDG: ' + (e instanceof Error ? e.message : String(e)))
  }
  try {
    hits.push(...(await searchWikipedia(query, 4)))
  } catch (e: unknown) {
    errors.push('Wiki: ' + (e instanceof Error ? e.message : String(e)))
  }
  if (!hits.length) {
    return {
      text: `Tidak ada hasil pencarian untuk "${query}".${errors.length ? ' (' + errors.join('; ') + ')' : ''}`,
      hits: [],
    }
  }
  const lines = hits.map(
    (h, i) => `${i + 1}. [${h.source}] ${h.title}\n   ${h.url}\n   ${h.snippet.slice(0, 220)}`
  )
  return {
    text: `## Hasil pencarian online (gratis, tanpa API key)\nQuery: ${query}\n\n${lines.join('\n\n')}`,
    hits,
  }
}

export function needsOnlineResearch(task: string): boolean {
  const t = task.toLowerCase()
  return /cari|search|riset|research|terbaru|best practice|bandingkan|hosting|deploy|gratis|free tier|dokumentasi|api|cara |bagaimana|online|vercel|netlify|github pages/.test(
    t
  )
}

export function buildResearchQueries(task: string): string[] {
  const queries = [task.slice(0, 120)]
  const t = task.toLowerCase()
  if (/dashboard|anggaran|budget/.test(t)) {
    queries.push('best free static hosting Vercel Netlify GitHub Pages')
    queries.push('dashboard realisasi anggaran UI best practice')
  }
  if (/hosting|deploy|online|production/.test(t)) {
    queries.push('free hosting static website Vercel Netlify Cloudflare Pages')
  }
  if (/auth|login|oauth/.test(t)) {
    queries.push('OAuth PKCE SPA security best practices')
  }
  return [...new Set(queries)].slice(0, 3)
}
