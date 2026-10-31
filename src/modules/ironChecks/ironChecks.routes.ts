import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { employeeName } from '../washLogs/washLogs.routes.js'

export const ironChecksRouter = Router()

type Basket = { items?: { qty?: number }[] }
const listQuery = z.object({ from: z.string().datetime(), to: z.string().datetime() })

// GET /api/iron-checks?from=&to= — nota yang selesai cuci di rentang ini + hasil hitungan di Setrika.
ironChecksRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as z.infer<typeof listQuery>
    const logs = await prisma.washLog.findMany({
      where: { finishedAt: { gte: new Date(from), lt: new Date(to) }, order: { needsIron: true } },
      orderBy: { finishedAt: 'asc' },
      select: {
        orderId: true,
        finishedAt: true,
        order: {
          select: {
            noNota: true,
            status: true,
            sortedLoad: true,
            customer: { select: { name: true } },
            ironCheck: true,
            swapsIn: { select: { qty: true } },
          },
        },
      },
    })
    res.json({
      data: logs.map(({ orderId, finishedAt, order }) => {
        const load = (order.sortedLoad ?? {}) as Record<string, Basket | undefined>
        return {
          orderId,
          washedAt: finishedAt,
          noNota: order.noNota,
          status: order.status,
          customerName: order.customer?.name ?? null,
          recorded: Object.values(load).reduce(
            (sum, basket) => sum + (basket?.items ?? []).reduce((total, item) => total + (item.qty ?? 0), 0),
            0,
          ),
          baskets: order.ironCheck?.baskets ?? null,
          operatorName: order.ironCheck?.operatorName ?? null,
          swappedIn: order.swapsIn.reduce((sum, swap) => sum + swap.qty, 0),
        }
      }),
    })
  }),
)

// POST /api/iron-checks  { orderId, baskets[] } — simpan hasil hitungan saat selesai setrika.
ironChecksRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      orderId: z.string().min(1),
      baskets: z.array(
        z.object({
          key: z.enum(['putih', 'hitam', 'satuan']),
          expected: z.number().int().nonnegative(),
          counted: z.number().int().nonnegative(),
        }),
      ),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { orderId, baskets } = req.body as { orderId: string; baskets: Prisma.InputJsonValue }
    if (!(await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } }))) throw ApiError.notFound('Order')
    const data = { baskets, operatorName: await employeeName(req.auth?.sub), checkedAt: new Date() }
    const check = await prisma.ironCheck.upsert({ where: { orderId }, create: { orderId, ...data }, update: data })
    res.status(201).json({ data: check })
  }),
)
