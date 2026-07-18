import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { ApiError } from '../utils/http.js'
import { isProd } from '../config/env.js'

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route tidak ditemukan: ${req.method} ${req.path}` })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details })
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validasi gagal',
      details: err.flatten(),
    })
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field'
      return res.status(409).json({ error: `Data dengan ${target} tersebut sudah ada` })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Data tidak ditemukan' })
    }
    return res.status(400).json({ error: 'Kesalahan database', code: err.code })
  }

  console.error('[unhandled]', err)
  res.status(500).json({
    error: 'Terjadi kesalahan internal',
    ...(isProd ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  })
}
