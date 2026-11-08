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
  kind: r.kind, // 'RUSAK' | 'MAINTENANCE' | 'CEROBONG' (lama)
  machineId: r.machineId,
  machineName: r.machineName ?? (r.kind === 'CEROBONG' ? 'Cerobong Asap' : null), // catatan lama cerobong tanpa nama
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

/** Aset non-mesin di katalog maintenance (tidak ada di tabel Machine). */
const ASSETS = ['Cerobong Asap', 'Mesin Air'] as const

// POST /api/maintenance  { kind, machineId? | asset?, note?, done? }
// Katalog: mesin cuci / pengering (machineId) atau aset (Cerobong Asap, Mesin Air).
// Rusak / Maintenance terbuka sampai ditandai selesai (mesin "perbaikan" selama terbuka);
// `done: true` = cukup catat hasilnya (langsung selesai, catatan wajib).
// `kind: 'CEROBONG'` = format lama, tetap diterima (= asset Cerobong Asap, langsung selesai).
maintenanceRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({
      kind: z.enum(['RUSAK', 'MAINTENANCE', 'CEROBONG']),
      machineId: z.string().min(1).optional(),
      asset: z.enum(ASSETS).optional(),
      note: z.string().trim().max(300).optional(),
      done: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { kind: 'RUSAK' | 'MAINTENANCE' | 'CEROBONG'; machineId?: string; asset?: string; note?: string; done?: boolean }
    if (body.kind === 'CEROBONG') Object.assign(body, { kind: 'MAINTENANCE', asset: 'Cerobong Asap', machineId: undefined, done: true })
    const kind = body.kind as 'RUSAK' | 'MAINTENANCE'
    const actor = await actorName(req)
    const finished = body.done ? { status: 'done', doneByName: actor, doneAt: new Date() } : {}
    if (body.done && !body.note) throw ApiError.badRequest('Tulis hasil maintenance-nya')

    if (!body.machineId) {
      if (!body.asset) throw ApiError.badRequest('Pilih mesin / barangnya')
      if (!body.done) {
        const open = await prisma.maintenanceRecord.findFirst({ where: { machineId: null, machineName: body.asset, status: 'open' } })
        if (open) throw ApiError.badRequest(`${body.asset} sudah tercatat ${open.kind === 'RUSAK' ? 'rusak' : 'maintenance'}`)
      }
      const record = await prisma.maintenanceRecord.create({
        data: { kind, machineName: body.asset, note: body.note || null, openedByName: actor, ...finished },
      })
      return res.status(201).json({ data: serialize(record) })
    }

    const machine = await prisma.machine.findUnique({ where: { id: body.machineId } })
    if (!machine) throw ApiError.notFound('Mesin')
    if (body.done) {
      const record = await prisma.maintenanceRecord.create({
        data: { kind, machineId: machine.id, machineName: machine.name, note: body.note || null, openedByName: actor, ...finished },
      })
      return res.status(201).json({ data: serialize(record) })
    }
    if (machine.currentOrderId) throw ApiError.badRequest(`${machine.name} masih berisi cucian — pindahkan dulu`)
    const open = await prisma.maintenanceRecord.findFirst({ where: { machineId: machine.id, status: 'open' } })
    if (open) throw ApiError.badRequest(`${machine.name} sudah tercatat ${open.kind === 'RUSAK' ? 'rusak' : 'maintenance'}`)

    const record = await prisma.$transaction(async (tx) => {
      await tx.machine.update({ where: { id: machine.id }, data: { status: 'MAINTENANCE' } })
      return tx.maintenanceRecord.create({
        data: { kind, machineId: machine.id, machineName: machine.name, note: body.note || null, openedByName: actor },
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
