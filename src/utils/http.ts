import type { NextFunction, Request, Response } from 'express'

/** Wrap async route handlers so thrown/rejected errors reach the error middleware. */
export function asyncHandler<
  T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

/** Operational error with an HTTP status code. */
export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
    this.name = 'ApiError'
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, `${resource} tidak ditemukan`)
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details)
  }

  static unauthorized(message = 'Tidak terautentikasi') {
    return new ApiError(401, message)
  }

  static forbidden(message = 'Akses ditolak') {
    return new ApiError(403, message)
  }
}
