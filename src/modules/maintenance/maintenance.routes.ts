import { Router } from 'express'
import { z } from 'zod'
import type { MaintenanceRecord } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { actorName } from '../../utils/actor.js'

export const maintenanceRouter = Router()

const serialize = (r: MaintenanceRecord) => ({
  id: r.id,
  kind: r.kind, // 'RUSAK' | 'MAINTENANCE' | 'CEROBONG'
  machineId: r.machineId,
  machineName: r.machineName,
  note: r.note,
  status: r.status, // 'open' | 'done'
  doneNote: r.doneNote,
  openedByName: r.openedByName,
  doneByName: r.doneByName,
  openedAt: r.openedAt,
  doneAt: r.doneAt,
})

// GET /api/maintenance?from=&to= — untuk laporan: yang dibuka / selesai di rentang itu.
// Tanpa rentang: semua yang masih terbuka + 40 riwayat terakhir.
maintenanceRouter.get(
  '/',
  validate({ query: z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }) }),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string }
    if (from && to) {
      const range = { gte: new Date(from), lt: new Date(to) }
      const records = await prisma.maintenanceRecord.findMany({
        where: { OR: [{ openedAt: range }, { doneAt: range }] },
        orderBy: { openedAt: 'asc' },
      })
      return res.json({ data: records.map(serialize) })
    }
    const [open, recent] = await Promise.all([
      prisma.maintenanceRecord.findMany({ where: { status: 'open' }, orderBy: { openedAt: 'desc' } }),
      prisma.maintenanceRecord.findMany({ where: { status: 'done' }, orderBy: { doneAt: 'desc' }, take: 40 }),
    ])
    res.json({ data: [...open, ...recent].map(serialize) })
  }),
)

// POST /api/maintenance  { kind, machineId?, note? }
// RUSAK / MAINTENANCE: mesin wajib, langsung ditandai perbaikan sampai selesai.
// CEROBONG: catat hasil maintenance cerobong asap (langsung selesai, catatan wajib).
maintenanceRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      kind: z.enum(['RUSAK', 'MAINTENANCE', 'CEROBONG']),
      machineId: z.string().min(1).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { kind: 'RUSAK' | 'MAINTENANCE' | 'CEROBONG'; machineId?: string; note?: string }
    const actor = await actorName(req)

    if (body.kind === 'CEROBONG') {
      if (!body.note) throw ApiError.badRequest('Tulis hasil maintenance cerobong')
      const record = await prisma.maintenanceRecord.create({
        data: { kind: 'CEROBONG', note: body.note, status: 'done', openedByName: actor, doneByName: actor, doneAt: new Date() },
      })
      return res.status(201).json({ data: serialize(record) })
    }

    if (!body.machineId) throw ApiError.badRequest('Pilih mesinnya')
    const machine = await prisma.machine.findUnique({ where: { id: body.machineId } })
    if (!machine) throw ApiError.notFound('Mesin')
    if (machine.currentOrderId) throw ApiError.badRequest(`${machine.name} masih berisi cucian — pindahkan dulu`)
    const open = await prisma.maintenanceRecord.findFirst({ where: { machineId: machine.id, status: 'open' } })
    if (open) throw ApiError.badRequest(`${machine.name} sudah tercatat ${open.kind === 'RUSAK' ? 'rusak' : 'maintenance'}`)

    const record = await prisma.$transaction(async (tx) => {
      await tx.machine.update({ where: { id: machine.id }, data: { status: 'MAINTENANCE' } })
      return tx.maintenanceRecord.create({
        data: { kind: body.kind, machineId: machine.id, machineName: machine.name, note: body.note || null, openedByName: actor },
      })
    })
    res.status(201).json({ data: serialize(record) })
  }),
)

// POST /api/maintenance/:id/done  { note? } — selesai; mesin kembali bisa dipakai.
maintenanceRouter.post(
  '/:id/done',
  requireAuth,
  validate({ body: z.object({ note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const record = await prisma.maintenanceRecord.findUnique({ where: { id: req.params.id } })
    if (!record) throw ApiError.notFound('Catatan maintenance')
    if (record.status === 'done') throw ApiError.badRequest('Sudah selesai')
    const doneByName = await actorName(req)
    const updated = await prisma.$transaction(async (tx) => {
      const done = await tx.maintenanceRecord.update({
        where: { id: record.id },
        data: { status: 'done', doneAt: new Date(), doneByName, doneNote: (req.body as { note?: string }).note || null },
      })
      if (record.machineId) {
        await tx.machine.updateMany({ where: { id: record.machineId, status: 'MAINTENANCE' }, data: { status: 'IDLE' } })
      }
      return done
    })
    res.json({ data: serialize(updated) })
  }),
)
