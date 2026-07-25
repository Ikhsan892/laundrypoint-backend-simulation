import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeAdjustment } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const adjustmentsRouter = Router()

const BASKETS = ['putih', 'hitam', 'satuan'] as const

const changeSchema = z.object({
  basket: z.enum(BASKETS),
  itemId: z.string().min(1),
  name: z.string(),
  emoji: z.string().optional(),
  fromQty: z.number().int().nonnegative(),
  toQty: z.number().int().nonnegative(),
})

// ── shapes for the sortedLoad JSON ──
interface SortItem {
  id: string
  emoji: string
  name: string
  qty: number
  service: string
  stain?: string
  net?: boolean
  hand?: boolean
}
interface Basket {
  weightKg?: number
  items: SortItem[]
}
interface SortedLoad {
  putih: Basket
  hitam: Basket
  satuan: Basket
}

// GET /api/adjustments?status=pending  — review queue.
adjustmentsRouter.get(
  '/',
  validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }) }),
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string | undefined)?.toUpperCase() as
      | 'PENDING'
      | 'APPROVED'
      | 'REJECTED'
      | undefined
    const adjustments = await prisma.orderAdjustment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { order: { include: { customer: true } } },
    })
    res.json({
      data: adjustments.map((a) => ({
        ...serializeAdjustment(a),
        order: { id: a.order.id, noNota: a.order.noNota, customerName: a.order.customer?.name ?? null },
      })),
    })
  }),
)

// POST /api/adjustments — request an item reduction (PENDING).
adjustmentsRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      orderId: z.string().min(1),
      changes: z.array(changeSchema).min(1, 'Tidak ada perubahan'),
      reason: z.string().optional(),
      requestedById: z.string().optional(),
      requestedByName: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      orderId: string
      changes: z.infer<typeof changeSchema>[]
      reason?: string
      requestedById?: string
      requestedByName?: string
    }
    const order = await prisma.order.findUnique({ where: { id: body.orderId } })
    if (!order) throw ApiError.notFound('Order')

    // Only reductions are allowed.
    for (const c of body.changes) {
      if (c.toQty > c.fromQty) throw ApiError.badRequest('Hanya boleh mengurangi jumlah item')
    }

    const adjustment = await prisma.orderAdjustment.create({
      data: {
        orderId: order.id,
        changes: body.changes as unknown as Prisma.InputJsonValue,
        reason: body.reason,
        requestedById: body.requestedById,
        requestedByName: body.requestedByName,
      },
    })
    res.status(201).json({ data: serializeAdjustment(adjustment) })
  }),
)

// POST /api/adjustments/:id/approve — apply the reduction to the order's sortedLoad.
adjustmentsRouter.post(
  '/:id/approve',
  requireAuth,
  validate({ body: z.object({ reviewedById: z.string().optional(), reviewedByName: z.string().optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { reviewedById?: string; reviewedByName?: string }
    const adjustment = await prisma.orderAdjustment.findUnique({ where: { id: req.params.id } })
    if (!adjustment) throw ApiError.notFound('Penyesuaian')
    if (adjustment.status !== 'PENDING') throw ApiError.badRequest('Penyesuaian sudah diproses')

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: adjustment.orderId } })
      const load = (order?.sortedLoad ?? null) as unknown as SortedLoad | null
      const changes = adjustment.changes as unknown as z.infer<typeof changeSchema>[]

      if (load) {
        for (const c of changes) {
          const basket = load[c.basket]
          if (!basket) continue
          const item = basket.items.find((i) => i.id === c.itemId)
          if (!item) continue
          item.qty = c.toQty
        }
        // drop zero-qty items
        for (const key of BASKETS) load[key].items = load[key].items.filter((i) => i.qty > 0)
        await tx.order.update({
          where: { id: adjustment.orderId },
          data: { sortedLoad: load as unknown as Prisma.InputJsonValue },
        })
      }

      return tx.orderAdjustment.update({
        where: { id: adjustment.id },
        data: {
          status: 'APPROVED',
          reviewedById: body.reviewedById,
          reviewedByName: body.reviewedByName,
          reviewedAt: new Date(),
        },
      })
    })
    res.json({ data: serializeAdjustment(updated) })
  }),
)

// POST /api/adjustments/:id/reject — decline the request (sortedLoad untouched).
adjustmentsRouter.post(
  '/:id/reject',
  requireAuth,
  validate({ body: z.object({ reviewedById: z.string().optional(), reviewedByName: z.string().optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { reviewedById?: string; reviewedByName?: string }
    const adjustment = await prisma.orderAdjustment.findUnique({ where: { id: req.params.id } })
    if (!adjustment) throw ApiError.notFound('Penyesuaian')
    if (adjustment.status !== 'PENDING') throw ApiError.badRequest('Penyesuaian sudah diproses')

    const updated = await prisma.orderAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: 'REJECTED',
        reviewedById: body.reviewedById,
        reviewedByName: body.reviewedByName,
        reviewedAt: new Date(),
      },
    })
    res.json({ data: serializeAdjustment(updated) })
  }),
)
