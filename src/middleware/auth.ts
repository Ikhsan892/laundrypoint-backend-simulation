import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../utils/http.js'

export interface AuthPayload {
  sub: string // employee id
  role: string
  scope: 'admin' | 'station'
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] })
}

// `reason: 'session'` = sesi login habis / tidak ada (beda dengan 401 PIN salah) → frontend minta login ulang.
const sessionError = (message: string) => new ApiError(401, message, { reason: 'session' })

/** Require a valid Bearer token; attaches req.auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(sessionError('Sesi login tidak ada — silakan login ulang'))
  }
  const token = header.slice('Bearer '.length)
  try {
    req.auth = jwt.verify(token, env.jwtSecret) as AuthPayload
    next()
  } catch {
    next(sessionError('Sesi login sudah habis — silakan login ulang'))
  }
}

/** Restrict a route to specific roles. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized())
    if (!roles.includes(req.auth.role)) return next(ApiError.forbidden())
    next()
  }
}
