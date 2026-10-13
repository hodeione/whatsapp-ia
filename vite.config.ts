/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/** En desarrollo sirve las funciones de api/ como lo haría Vercel. */
function api(): Plugin {
  return {
    name: 'api-local',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const ruta = req.url.split('?')[0]!.replace(/^\/api\//, '')
        if (!/^[a-z-]+$/.test(ruta)) return next()
        try {
          const mod = (await server.ssrLoadModule(`/api/${ruta}.ts`)) as Record<string, (r: Request) => Promise<Response> | Response>
          const handler = mod[req.method ?? 'GET']
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })
          const response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          if (response.body) {
            const reader = response.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          }
          res.end()
        } catch (err) {
          server.config.logger.error(String(err))
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Error interno' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), api()],
  test: { include: ['tests/**/*.test.ts'] },
})
