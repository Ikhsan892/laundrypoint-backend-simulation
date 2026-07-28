import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { env, isProd } from './config/env.js'
import { apiRouter } from './routes.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'

// Where the built frontend lives. In the Docker image the Vue `dist/` is copied
// to /app/public; in dev it's absent and the API just runs on its own.
const here = path.dirname(fileURLToPath(import.meta.url))
const webDir = process.env.WEB_DIR ?? path.resolve(here, '../public')
const hasFrontend = fs.existsSync(path.join(webDir, 'index.html'))

export function createApp() {
  const app = express()
  app.disable('x-powered-by')

  app.use(
    cors({
      // Same-origin (frontend served by this server) needs no CORS. Kept for
      // dev (any localhost port) and any explicit CORS_ORIGIN allow-list.
      origin(origin, callback) {
        if (!origin) return callback(null, true) // curl / same-origin / server-to-server
        const allowed =
          env.corsOrigin.includes(origin) ||
          (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
        callback(null, allowed)
      },
      credentials: true,
    }),
  )
  // 8mb to accommodate base64 Lost & Found photos (compressed client-side).
  app.use(express.json({ limit: '8mb' }))
  app.use(express.urlencoded({ extended: true }))
  if (!isProd) app.use(morgan('dev'))

  // ── API ──
  app.use('/api', apiRouter)

  // ── Frontend (single-image deploy) ──
  if (hasFrontend) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }))
    // SPA fallback: any non-API GET returns index.html (client-side routing).
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(path.join(webDir, 'index.html'))
    })
  } else {
    app.get('/', (_req, res) => {
      res.json({ service: 'Laundry Point API', health: '/api/health' })
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
