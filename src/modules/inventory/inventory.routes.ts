import { Router } from 'express'
import { z } from 'zod'
import type { InventoryItem, InventoryMove, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { actorName } from '../../utils/actor.js'

export const inventoryRouter = Router()

const station = z.enum(['cuci', 'setrika', 'packing', 'kasir'])
const moveType = z.enum(['masuk', 'pakai'])

const serializeItem = (item: InventoryItem, stock: number) => ({
  id: item.id,
  station: item.station,
  name: item.name,
  unit: item.unit,
  machineType: item.machineType?.toLowerCase() ?? null, // 'dryer' = pemakaian wajib pilih pengering
  stock,
})

const serializeMove = (move: InventoryMove & { item: Pick<InventoryItem, 'name' | 'unit' | 'station'> }) => ({
  id: move.id,
  itemId: move.itemId,
  itemName: move.item.name,
  unit: move.item.unit,
  station: move.item.station,
  type: move.type,
  qty: move.qty,
  note: move.note,
  machineId: move.machineId,
  machineName: move.machineName,
  employeeName: move.employeeName,
  recordedAt: move.recordedAt,
})

const moveInclude = { item: { select: { name: true, unit: true, station: true } } } satisfies Prisma.InventoryMoveInclude

/** Mesin untuk pemakaian barang yang terikat jenis mesin (mis. gas → pengering). */
async function machineFor(item: InventoryItem, machineId: string | null | undefined) {
  if (!item.machineType) return { machineId: null, machineName: null }
  if (!machineId) throw ApiError.badRequest('Pilih mesinnya dulu')
  const machine = await prisma.machine.findUnique({ where: { id: machineId } })
  if (!machine || machine.type !== item.machineType) throw ApiError.badRequest('Mesin tidak cocok')
  return { machineId: machine.id, machineName: machine.name }
}

// GET /api/inventory?station= — barang aktif di station + stok saat ini (masuk − pakai).
inventoryRouter.get(
  '/',
  validate({ query: z.object({ station }) }),
  asyncHandler(async (req, res) => {
    const items = await prisma.inventoryItem.findMany({
      where: { station: req.query.station as string, active: true },
      orderBy: { createdAt: 'asc' },
    })
    const sums = await prisma.inventoryMove.groupBy({
      by: ['itemId', 'type'],
      where: { itemId: { in: items.map((i) => i.id) } },
      _sum: { qty: true },
    })
    const stock = (id: string) =>
      sums.filter((s) => s.itemId === id).reduce((total, s) => total + (s.type === 'masuk' ? 1 : -1) * (s._sum.qty ?? 0), 0)
    res.json({ data: items.map((item) => serializeItem(item, Math.round(stock(item.id) * 100) / 100)) })
  }),
)

// POST /api/inventory  { station, name, unit } — tambah barang di station.
inventoryRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({ station, name: z.string().trim().min(1).max(60), unit: z.string().trim().min(1).max(20) }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { station: string; name: string; unit: string }
    const existing = await prisma.inventoryItem.findUnique({ where: { station_name: { station: body.station, name: body.name } } })
    if (existing?.active) throw ApiError.badRequest(`${body.name} sudah ada`)
    // Barang yang pernah dihapus diaktifkan lagi (riwayatnya tetap).
    const item = existing
      ? await prisma.inventoryItem.update({ where: { id: existing.id }, data: { active: true, unit: body.unit } })
      : await prisma.inventoryItem.create({ data: body })
    res.status(201).json({ data: serializeItem(item, 0) })
  }),
)

// PATCH /api/inventory/:id  { name?, unit?, active? } — ubah / sembunyikan barang.
inventoryRouter.patch(
  '/:id',
  requireAuth,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      unit: z.string().trim().min(1).max(20).optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data: req.body })
    res.json({ data: serializeItem(item, 0) })
  }),
)

// GET /api/inventory/moves?station=&itemId=&from=&to= — riwayat masuk & pakai.
inventoryRouter.get(
  '/moves',
  validate({
    query: z.object({
      station: station.optional(),
      itemId: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { station: at, itemId, from, to } = req.query as Record<string, string | undefined>
    const moves = await prisma.inventoryMove.findMany({
      where: {
        ...(itemId ? { itemId } : {}),
        ...(at ? { item: { station: at } } : {}),
        ...(from && to ? { recordedAt: { gte: new Date(from), lt: new Date(to) } } : {}),
      },
      include: moveInclude,
      orderBy: { recordedAt: 'desc' },
      take: 200,
    })
    res.json({ data: moves.map(serializeMove) })
  }),
)

const moveBody = z.object({
  qty: z.number().positive().max(100_000),
  note: z.string().trim().max(200).optional(),
  machineId: z.string().min(1).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
})

// POST /api/inventory/:id/moves  { type, qty, note?, machineId?, recordedAt? } — barang masuk / pemakaian.
inventoryRouter.post(
  '/:id/moves',
  requireAuth,
  validate({ body: moveBody.extend({ type: moveType }) }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof moveBody> & { type: 'masuk' | 'pakai' }
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } })
    if (!item) throw ApiError.notFound('Barang')
    const machine = body.type === 'pakai' ? await machineFor(item, body.machineId) : { machineId: null, machineName: null }
    const move = await prisma.inventoryMove.create({
      data: {
        itemId: item.id,
        type: body.type,
        qty: body.qty,
        note: body.note || null,
        ...machine,
        employeeName: await actorName(req),
        ...(body.recordedAt ? { recordedAt: new Date(body.recordedAt) } : {}),
      },
      include: moveInclude,
    })
    res.status(201).json({ data: serializeMove(move) })
  }),
)

// PATCH /api/inventory/moves/:moveId — koreksi jumlah, catatan, mesin, atau jam & hari.
inventoryRouter.patch(
  '/moves/:moveId',
  requireAuth,
  validate({ body: moveBody.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof moveBody>>
    const current = await prisma.inventoryMove.findUnique({ where: { id: req.params.moveId }, include: { item: true } })
    if (!current) throw ApiError.notFound('Catatan')
    const machine =
      current.type === 'pakai' && body.machineId !== undefined ? await machineFor(current.item, body.machineId) : {}
    const move = await prisma.inventoryMove.update({
      where: { id: current.id },
      data: {
        ...(body.qty !== undefined ? { qty: body.qty } : {}),
        ...(body.note !== undefined ? { note: body.note || null } : {}),
        ...(body.recordedAt ? { recordedAt: new Date(body.recordedAt) } : {}),
        ...machine,
      },
      include: moveInclude,
    })
    res.json({ data: serializeMove(move) })
  }),
)

// DELETE /api/inventory/moves/:moveId — hapus catatan yang salah input.
inventoryRouter.delete(
  '/moves/:moveId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.inventoryMove.delete({ where: { id: req.params.moveId } })
    res.status(204).end()
  }),
)
