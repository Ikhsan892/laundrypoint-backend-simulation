import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeLostFound } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const lostFoundRouter = Router()

// A data-URL image (base64), compressed on the client — keep the cap sane.
const photoSchema = z
  .string()
  .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Foto harus data URL gambar')
  .max(8_000_000, 'Foto terlalu besar')

const listQuery = z.object({
  orderId: z.string().optional(),
  status: z.enum(['open', 'claimed']).optional(),
})

const createSchema = z.object({
  orderId: z.string().optional(),
  description: z.string().optional(),
  photo: photoSchema.optional(),
  station: z.string().optional(),
  reportedById: z.string().optional(),
  reportedByName: z.string().optional(),
})

// GET /api/lost-found?orderId=&status=
lostFoundRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { orderId, status } = req.query as z.infer<typeof listQuery>
    const where: Prisma.LostFoundWhereInput = {
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
    }
    const items = await prisma.lostFound.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ data: items.map(serializeLostFound) })
  }),
)

// POST /api/lost-found — log a found item (optionally with a photo).
lostFoundRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    if (body.orderId) {
      const order = await prisma.order.findUnique({ where: { id: body.orderId }, select: { id: true } })
      if (!order) throw ApiError.notFound('Order')
    }
    const item = await prisma.lostFound.create({
      data: {
        orderId: body.orderId,
        description: body.description?.trim() || 'Barang kehilangan',
        photo: body.photo,
        station: body.station,
        reportedById: body.reportedById,
        reportedByName: body.reportedByName,
      },
    })
    res.status(201).json({ data: serializeLostFound(item) })
  }),
)

// PATCH /api/lost-found/:id — mark claimed / update.
lostFoundRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: z.object({ status: z.enum(['open', 'claimed']).optional() }) }),
  asyncHandler(async (req, res) => {
    const item = await prisma.lostFound.update({
      where: { id: req.params.id },
      data: { status: (req.body as { status?: string }).status },
    })
    res.json({ data: serializeLostFound(item) })
  }),
)
