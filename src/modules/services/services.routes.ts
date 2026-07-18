import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import {
  serializeService,
  fromUiUnit,
  fromUiCategory,
} from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const servicesRouter = Router()

const UI_CATEGORIES = ['kiloan', 'non-kiloan', '3rd-party'] as const
const UI_UNITS = ['kg', 'pcs', 'm', 'psg'] as const

const listQuery = z.object({
  category: z.enum(UI_CATEGORIES).optional(),
  q: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
})

const bodySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().optional(),
  emoji: z.string().optional(),
  price: z.number().int().nonnegative(),
  unit: z.enum(UI_UNITS),
  step: z.number().positive().default(1),
  category: z.enum(UI_CATEGORIES),
  duration: z.string().optional(),
  active: z.boolean().default(true),
})

// GET /api/services — the cashier catalog.
servicesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { category, q, active } = req.query as z.infer<typeof listQuery>
    const where: Prisma.ServiceWhereInput = {
      ...(category ? { category: fromUiCategory(category) } : {}),
      ...(active ? { active: active === 'true' } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    }
    const services = await prisma.service.findMany({ where, orderBy: { name: 'asc' } })
    res.json({ data: services.map(serializeService) })
  }),
)

// GET /api/services/:id
servicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await prisma.service.findUnique({ where: { id: req.params.id } })
    if (!service) throw ApiError.notFound('Layanan')
    res.json({ data: serializeService(service) })
  }),
)

// POST /api/services
servicesRouter.post(
  '/',
  requireAuth,
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bodySchema>
    const service = await prisma.service.create({
      data: {
        slug: body.slug,
        name: body.name,
        subtitle: body.subtitle,
        emoji: body.emoji,
        price: body.price,
        unit: fromUiUnit(body.unit)!,
        step: body.step,
        category: fromUiCategory(body.category)!,
        duration: body.duration,
        active: body.active,
      },
    })
    res.status(201).json({ data: serializeService(service) })
  }),
)

// PATCH /api/services/:id
servicesRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: bodySchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof bodySchema>>
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data: {
        slug: body.slug,
        name: body.name,
        subtitle: body.subtitle,
        emoji: body.emoji,
        price: body.price,
        step: body.step,
        duration: body.duration,
        active: body.active,
        ...(body.unit ? { unit: fromUiUnit(body.unit) } : {}),
        ...(body.category ? { category: fromUiCategory(body.category) } : {}),
      },
    })
    res.json({ data: serializeService(service) })
  }),
)

// DELETE /api/services/:id
servicesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.service.delete({ where: { id: req.params.id } })
    res.status(204).end()
  }),
)
