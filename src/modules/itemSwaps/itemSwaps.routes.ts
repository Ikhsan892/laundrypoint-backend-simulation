import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { employeeName } from '../washLogs/washLogs.routes.js'

export const itemSwapsRouter = Router()

// GET /api/item-swaps?orderId= — barang yang dipindah ke nota ini.
itemSwapsRouter.get(
  '/',
  validate({ query: z.object({ orderId: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const swaps = await prisma.itemSwap.findMany({
      where: { toOrderId: req.query.orderId as string },
      include: { fromOrder: { select: { noNota: true, customer: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      data: swaps.map(({ fromOrder, ...swap }) => ({
        ...swap,
        fromNota: fromOrder.noNota,
        fromCustomer: fromOrder.customer?.name ?? null,
      })),
    })
  }),
)

// POST /api/item-swaps — catat barang fisik yang dipindah antar nota. Jumlah tercatat (sortedLoad) tidak berubah.
itemSwapsRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      fromOrderId: z.string().min(1),
      toOrderId: z.string().min(1),
      basket: z.enum(['putih', 'hitam', 'satuan']),
      qty: z.number().int().positive().max(999),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { fromOrderId: string; toOrderId: string; basket: string; qty: number }
    if (body.fromOrderId === body.toOrderId) throw ApiError.badRequest('Nota asal dan tujuan sama')
    const orders = await prisma.order.findMany({ where: { id: { in: [body.fromOrderId, body.toOrderId] } }, select: { status: true } })
    if (orders.length !== 2) throw ApiError.notFound('Order')
    // Barang di nota yang sudah diserahkan / batal tidak bisa dipindah lagi.
    if (orders.some((o) => o.status === 'SELESAI' || o.status === 'BATAL')) throw ApiError.badRequest('Nota sudah selesai atau batal')
    const swap = await prisma.itemSwap.create({ data: { ...body, byName: await employeeName(req.auth?.sub) } })
    res.status(201).json({ data: swap })
  }),
)
