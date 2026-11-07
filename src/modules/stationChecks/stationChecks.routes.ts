import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { actorName } from '../../utils/actor.js'

export const stationChecksRouter = Router()

type Basket = { items?: { qty?: number }[] }
const station = z.enum(['setrika', 'packing'])
const listQuery = z.object({ station, from: z.string().datetime(), to: z.string().datetime() })

const recorded = (sortedLoad: Prisma.JsonValue) =>
  Object.values((sortedLoad ?? {}) as Record<string, Basket | undefined>).reduce(
    (sum, basket) => sum + (basket?.items ?? []).reduce((total, item) => total + (item.qty ?? 0), 0),
    0,
  )

const orderSelect = (at: string) =>
  ({
    noNota: true,
    status: true,
    sortedLoad: true,
    customer: { select: { name: true } },
    checks: { where: { station: at } },
    swapsIn: { select: { qty: true } },
  }) satisfies Prisma.OrderSelect

type OrderRow = Prisma.OrderGetPayload<{ select: ReturnType<typeof orderSelect> }>

const row = (orderId: string, at: Date | null, order: OrderRow) => ({
  orderId,
  at,
  noNota: order.noNota,
  status: order.status,
  customerName: order.customer?.name ?? null,
  recorded: recorded(order.sortedLoad),
  baskets: order.checks[0]?.baskets ?? null,
  operatorName: order.checks[0]?.operatorName ?? null,
  swappedIn: order.swapsIn.reduce((sum, swap) => sum + swap.qty, 0),
})

// GET /api/station-checks?station=&from=&to=
//   setrika: nota yang selesai cuci di rentang ini + hasil hitungannya (yang belum dicek ikut tampil).
//   packing: nota yang dihitung di Packing pada rentang ini.
stationChecksRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { station: at, from, to } = req.query as z.infer<typeof listQuery>
    const range = { gte: new Date(from), lt: new Date(to) }
    if (at === 'setrika') {
      const logs = await prisma.washLog.findMany({
        where: { finishedAt: range, order: { needsIron: true } },
        orderBy: { finishedAt: 'asc' },
        select: { orderId: true, finishedAt: true, order: { select: orderSelect(at) } },
      })
      return res.json({ data: logs.map((log) => row(log.orderId, log.finishedAt, log.order)) })
    }
    const checks = await prisma.stationCheck.findMany({
      where: { station: at, checkedAt: range },
      orderBy: { checkedAt: 'asc' },
      select: { orderId: true, checkedAt: true, order: { select: orderSelect(at) } },
    })
    res.json({ data: checks.map((check) => row(check.orderId, check.checkedAt, check.order)) })
  }),
)

// POST /api/station-checks  { orderId, station, baskets[] } — simpan hasil hitung ulang saat selesai di station.
stationChecksRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      orderId: z.string().min(1),
      station,
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
    const { orderId, station: at, baskets } = req.body as { orderId: string; station: string; baskets: Prisma.InputJsonValue }
    if (!(await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } }))) throw ApiError.notFound('Order')
    const data = { baskets, operatorName: await actorName(req), checkedAt: new Date() }
    const check = await prisma.stationCheck.upsert({
      where: { orderId_station: { orderId, station: at } },
      create: { orderId, station: at, ...data },
      update: data,
    })
    res.status(201).json({ data: check })
  }),
)
