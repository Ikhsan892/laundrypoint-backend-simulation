import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const outletsRouter = Router()

const bodySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  instagram: z.string().optional(),
})

// GET /api/outlets
outletsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const outlets = await prisma.outlet.findMany({ orderBy: { name: 'asc' } })
    res.json({ data: outlets })
  }),
)

// GET /api/outlets/:id
outletsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const outlet = await prisma.outlet.findUnique({ where: { id: req.params.id } })
    if (!outlet) throw ApiError.notFound('Outlet')
    res.json({ data: outlet })
  }),
)

// POST /api/outlets
outletsRouter.post(
  '/',
  requireAuth,
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    const outlet = await prisma.outlet.create({ data: req.body })
    res.status(201).json({ data: outlet })
  }),
)

// PATCH /api/outlets/:id
outletsRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: bodySchema.partial() }),
  asyncHandler(async (req, res) => {
    const outlet = await prisma.outlet.update({ where: { id: req.params.id }, data: req.body })
    res.json({ data: outlet })
  }),
)
