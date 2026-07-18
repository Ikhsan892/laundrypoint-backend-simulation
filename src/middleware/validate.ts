import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny, infer as ZodInfer } from 'zod'

type Schemas = {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/**
 * Validate & coerce request parts against zod schemas.
 * Parsed values overwrite req.body/query/params so handlers get typed data.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body)
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query))
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params))
      next()
    } catch (err) {
      next(err)
    }
  }
}

export type Infer<T extends ZodTypeAny> = ZodInfer<T>
