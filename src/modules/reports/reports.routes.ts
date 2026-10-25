import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler } from '../../utils/http.js'

export const reportsRouter = Router()

// GET /api/reports/pipeline — order counts by current status (all orders).
reportsRouter.get(
  '/pipeline',
  asyncHandler(async (_req, res) => {
    const groups = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } })
    const byStatus: Record<string, number> = {}
    for (const g of groups) byStatus[g.status] = g._count._all
    res.json({ data: byStatus })
  }),
)

// GET /api/reports/today — shift summary for the current day.
reportsRouter.get(
  '/today',
  asyncHandler(async (_req, res) => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const today = { gte: start, lt: end }

    const [ordersToday, statusGroups, paymentsAgg, openBills, newCustomers, completedToday] =
      await Promise.all([
        prisma.order.count({ where: { createdAt: today } }),
        prisma.order.groupBy({
          by: ['status'],
          _count: { _all: true },
          where: { createdAt: today },
        }),
        prisma.payment.aggregate({
          _sum: { amount: true },
          _count: { _all: true },
          where: { paidAt: today },
        }),
        prisma.order.aggregate({
          _sum: { total: true },
          _count: { _all: true },
          where: { paymentStatus: 'BELUM_BAYAR', status: { not: 'BATAL' } },
        }),
        prisma.customer.count({ where: { createdAt: today } }),
        prisma.order.count({ where: { status: 'SELESAI', updatedAt: today } }),
      ])

    const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]))

    res.json({
      data: {
        date: start.toISOString(),
        ordersToday,
        completedToday,
        byStatus,
        revenueToday: paymentsAgg._sum.amount ?? 0,
        paymentsToday: paymentsAgg._count._all,
        openBills: { count: openBills._count._all, amount: openBills._sum.total ?? 0 },
        newCustomersToday: newCustomers,
      },
    })
  }),
)
