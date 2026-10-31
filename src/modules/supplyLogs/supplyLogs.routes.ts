import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { employeeName } from '../washLogs/washLogs.routes.js'

export const supplyLogsRouter = Router()

const kind = z.enum(['sabun', 'softener', 'gas', 'uap', 'air'])
const entry = z.object({
  qty: z.number().min(0).max(100_000), // 0 = sisa habis
  note: z.string().trim().max(200).optional(),
  recordedAt: z.string().datetime().optional(),
})

const listQuery = z.object({
  kind: kind.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// GET /api/supply-logs?kind=&from=&to= — catatan terbaru.
supplyLogsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { kind: only, from, to } = req.query as z.infer<typeof listQuery>
    const logs = await prisma.supplyLog.findMany({
      where: {
        ...(only ? { kind: only } : {}),
        ...(from && to ? { recordedAt: { gte: new Date(from), lt: new Date(to) } } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    })
    res.json({ data: logs })
  }),
)

// POST /api/supply-logs  { kind, qty, note?, recordedAt? } — tanpa recordedAt = sekarang.
supplyLogsRouter.post(
  '/',
  requireAuth,
  validate({ body: entry.extend({ kind }) }),
  asyncHandler(async (req, res) => {
    const log = await prisma.supplyLog.create({
      data: { ...req.body, employeeName: await employeeName(req.auth?.sub) },
    })
    res.status(201).json({ data: log })
  }),
)

// PATCH /api/supply-logs/:id — koreksi jumlah, catatan, atau jam & hari.
supplyLogsRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: entry }),
  asyncHandler(async (req, res) => {
    const log = await prisma.supplyLog.update({ where: { id: req.params.id }, data: req.body })
    res.json({ data: log })
  }),
)
