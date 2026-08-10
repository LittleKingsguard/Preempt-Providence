// Zero-dependency static server for the browser demos.
// Run: npm run demo  (builds dist/core, then serves the project root).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', `http://${req.headers.host}`).pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.listen(PORT, () => {
  console.log(`Preempt-Providence demos: http://localhost:${PORT}/demo/`)
})
