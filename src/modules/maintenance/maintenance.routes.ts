import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { employeeName } from '../washLogs/washLogs.routes.js'

export const maintenanceRouter = Router()

const include = { machine: { select: { name: true } } }

// GET /api/maintenance
maintenanceRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const schedules = await prisma.maintenanceSchedule.findMany({ include, orderBy: { createdAt: 'asc' } })
    res.json({ data: schedules })
  }),
)

const logQuery = z.object({ from: z.string().datetime(), to: z.string().datetime() })

// GET /api/maintenance/logs?from=&to= — riwayat pengerjaan untuk laporan.
maintenanceRouter.get(
  '/logs',
  validate({ query: logQuery }),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as z.infer<typeof logQuery>
    const logs = await prisma.maintenanceLog.findMany({
      where: { doneAt: { gte: new Date(from), lt: new Date(to) } },
      orderBy: { doneAt: 'asc' },
    })
    res.json({ data: logs })
  }),
)

// POST /api/maintenance  { task, intervalDays, machineId? } — hitungan mulai dari hari ini.
maintenanceRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      task: z.string().trim().min(1, 'Isi nama pekerjaan').max(120),
      intervalDays: z.number().int().positive().max(3650),
      machineId: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const schedule = await prisma.maintenanceSchedule.create({ data: req.body, include })
    res.status(201).json({ data: schedule })
  }),
)

// POST /api/maintenance/:id/done — sudah dikerjakan, siklus mulai lagi dari sekarang.
maintenanceRouter.post(
  '/:id/done',
  requireAuth,
  asyncHandler(async (req, res) => {
    const doneByName = await employeeName(req.auth?.sub)
    const schedule = await prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceSchedule.update({
        where: { id: req.params.id },
        data: { lastDoneAt: new Date(), lastDoneByName: doneByName },
        include,
      })
      await tx.maintenanceLog.create({
        data: { task: updated.task, machineName: updated.machine?.name, doneByName, doneAt: updated.lastDoneAt },
      })
      return updated
    })
    res.json({ data: schedule })
  }),
)

// DELETE /api/maintenance/:id
maintenanceRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.maintenanceSchedule.delete({ where: { id: req.params.id } })
    res.status(204).end()
  }),
)
