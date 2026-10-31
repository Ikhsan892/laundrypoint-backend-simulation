import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const washLogsRouter = Router()

/** Nama karyawan dari token, untuk kolom petugas. */
export async function employeeName(employeeId?: string) {
  if (!employeeId) return null
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } })
  return employee?.name ?? null
}

/** Catat mesin cuci yang dipakai nota ini — mesinnya nanti dilepas, jadi namanya disimpan di sini. */
export async function recordWashers(tx: Prisma.TransactionClient, orderId: string, names: string[]) {
  const log = await tx.washLog.findUnique({ where: { orderId }, select: { washers: true } })
  const washers = [...new Set([...(log?.washers ?? []), ...names])]
  await tx.washLog.upsert({ where: { orderId }, create: { orderId, washers }, update: { washers } })
}

/** Nota keluar dari station Cuci & Kering → baris masuk laporan (idempotent). */
export async function closeWashLog(tx: Prisma.TransactionClient, orderId: string, operatorName: string | null) {
  const log = await tx.washLog.findUnique({ where: { orderId }, select: { finishedAt: true } })
  if (log?.finishedAt) return
  const data = { finishedAt: new Date(), operatorName }
  await tx.washLog.upsert({ where: { orderId }, create: { orderId, ...data }, update: data })
}

const include = { order: { include: { customer: true } } } satisfies Prisma.WashLogInclude
type WashLogRow = Prisma.WashLogGetPayload<{ include: typeof include }>
type Basket = { items?: { qty?: number }[] }

function serializeWashLog(log: WashLogRow) {
  const load = (log.order.sortedLoad ?? {}) as Record<string, Basket | undefined>
  const qty = (key: string) => (load[key]?.items ?? []).reduce((sum, item) => sum + (item.qty ?? 0), 0)
  return {
    id: log.id,
    orderId: log.orderId,
    noNota: log.order.noNota,
    customerName: log.order.customer?.name ?? null,
    package: log.order.package?.toLowerCase() ?? null,
    washers: log.washers,
    totalPcs: qty('putih') + qty('hitam'),
    satuan: qty('satuan'),
    tower: log.tower ?? log.order.customer?.address ?? null,
    bedDuvet: log.bedDuvet,
    sb: log.sb,
    sg: log.sg,
    notes: log.notes,
    operatorName: log.operatorName,
    finishedAt: log.finishedAt,
  }
}

const listQuery = z.object({ from: z.string().datetime(), to: z.string().datetime() })

// GET /api/wash-logs?from=&to= — isi lembar laporan untuk rentang waktu.
washLogsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as z.infer<typeof listQuery>
    const logs = await prisma.washLog.findMany({
      where: { finishedAt: { gte: new Date(from), lt: new Date(to) } },
      include,
      orderBy: { finishedAt: 'asc' },
    })
    res.json({ data: logs.map(serializeWashLog) })
  }),
)

// GET /api/wash-logs/:orderId
washLogsRouter.get(
  '/:orderId',
  asyncHandler(async (req, res) => {
    const log = await prisma.washLog.findUnique({ where: { orderId: req.params.orderId }, include })
    if (!log) throw ApiError.notFound('Laporan cuci')
    res.json({ data: serializeWashLog(log) })
  }),
)

const qty = z.number().int().min(0).max(999)

// PATCH /api/wash-logs/:orderId — lengkapi kolom yang diisi manual.
washLogsRouter.patch(
  '/:orderId',
  requireAuth,
  validate({
    body: z.object({
      tower: z.string().trim().max(120),
      bedDuvet: qty,
      sb: qty,
      sg: qty,
      notes: z.string().trim().max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    const log = await prisma.washLog.update({ where: { orderId: req.params.orderId }, data: req.body, include })
    res.json({ data: serializeWashLog(log) })
  }),
)
