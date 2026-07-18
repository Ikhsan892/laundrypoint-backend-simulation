import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { env, isProd } from './config/env.js'
import { apiRouter } from './routes.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'

export function createApp() {
  const app = express()

  app.use(
    cors({
      // In dev, accept any localhost port (Vite may pick 5173, 5174, …).
      // In prod, only the explicit CORS_ORIGIN allow-list.
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
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  if (!isProd) app.use(morgan('dev'))

  app.get('/', (_req, res) => {
    res.json({ service: 'Laundry Point API', docs: '/api/health' })
  })

  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
