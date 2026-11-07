import { Router } from 'express'
import { z } from 'zod'
import type { BrandedItem, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { actorName } from '../../utils/actor.js'

export const brandedItemsRouter = Router()

function serialize(d: BrandedItem) {
  return {
    id: d.id,
    orderId: d.orderId,
    description: d.description,
    photo: d.photo,
    station: d.station,
    status: d.status,
    reportedById: d.reportedById,
    reportedByName: d.reportedByName,
    createdAt: d.createdAt,
  }
}

const photoSchema = z
  .string()
  .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Foto harus data URL gambar')
  .max(8_000_000, 'Foto terlalu besar')

const listQuery = z.object({
  orderId: z.string().optional(),
  status: z.enum(['open', 'resolved']).optional(),
})

const createSchema = z.object({
  orderId: z.string().optional(),
  description: z.string().optional(),
  photo: photoSchema.optional(),
  station: z.string().optional(),
  reportedById: z.string().optional(),
  reportedByName: z.string().optional(),
})

// GET /api/branded-items?orderId=&status=
brandedItemsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { orderId, status } = req.query as z.infer<typeof listQuery>
    const where: Prisma.BrandedItemWhereInput = {
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
    }
    const items = await prisma.brandedItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ data: items.map(serialize) })
  }),
)

// POST /api/branded-items — catat barang branded / baru (dengan foto).
brandedItemsRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    if (body.orderId) {
      const order = await prisma.order.findUnique({ where: { id: body.orderId }, select: { id: true } })
      if (!order) throw ApiError.notFound('Order')
    }
    const item = await prisma.brandedItem.create({
      data: {
        orderId: body.orderId,
        description: body.description?.trim() || 'Barang branded',
        photo: body.photo,
        station: body.station,
        reportedById: body.reportedById,
        reportedByName: body.reportedByName ?? (await actorName(req)),
      },
    })
    res.status(201).json({ data: serialize(item) })
  }),
)

// PATCH /api/branded-items/:id — tandai sudah diserahkan.
brandedItemsRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: z.object({ status: z.enum(['open', 'resolved']).optional() }) }),
  asyncHandler(async (req, res) => {
    const item = await prisma.brandedItem.update({
      where: { id: req.params.id },
      data: { status: (req.body as { status?: string }).status },
    })
    res.json({ data: serialize(item) })
  }),
)
