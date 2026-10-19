# Virtual Office AI Pro

Multi-agent virtual office dengan output file nyata.

## Fitur
- 4 agent (Manager, Coder, Researcher, Writer)
- Animasi office real-time
- Agent menghasilkan file (kode, markdown) yang bisa di-download
- Support Groq / Gemini / OpenRouter / **Cloudflare Workers AI** (gratis)

## Online
Deploy di Vercel — isi API key gratis lalu kirim tugas.

### Cloudflare Workers AI
1. Settings → klik preset **Cloudflare AI**
2. API Key = token Cloudflare (`cfat_...`)
3. Model contoh: `@cf/meta/llama-3.1-8b-instruct` atau `@cf/openai/gpt-oss-20b`
4. Save to cloud

API Key lain: https://console.groq.com · https://aistudio.google.com/apikey
