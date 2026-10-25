import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeMachine } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const machinesRouter = Router()

const TYPES = ['WASHER', 'DRYER'] as const
const STATUSES = ['IDLE', 'RUNNING', 'DONE', 'MAINTENANCE'] as const

const machineInclude = {
  currentOrder: { include: { customer: true } },
} satisfies Prisma.MachineInclude

// Bentuk satu basket di Order.sortedLoad (hasil Cek & Pilah).
type SortBasket = { items: { qty: number }[]; doneAt?: string }
const basketQty = (basket?: SortBasket) => (basket?.items ?? []).reduce((sum, item) => sum + (item.qty ?? 0), 0)

const listQuery = z.object({
  type: z.enum(['washer', 'dryer']).optional(),
  status: z.enum(['idle', 'running', 'done', 'maintenance']).optional(),
})

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['washer', 'dryer']),
  capacityKg: z.number().positive().optional(),
  status: z.enum(['idle', 'running', 'done', 'maintenance']).optional(),
  outletId: z.string().optional(),
})

const updateSchema = createSchema.partial()

// GET /api/machines?type=&status=
machinesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { type, status } = req.query as z.infer<typeof listQuery>
    const where: Prisma.MachineWhereInput = {
      ...(type ? { type: type.toUpperCase() as (typeof TYPES)[number] } : {}),
      ...(status ? { status: status.toUpperCase() as (typeof STATUSES)[number] } : {}),
    }
    const machines = await prisma.machine.findMany({
      where,
      include: machineInclude,
      orderBy: { name: 'asc' },
    })
    res.json({ data: machines.map(serializeMachine) })
  }),
)

// GET /api/machines/:id
machinesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const machine = await prisma.machine.findUnique({
      where: { id: req.params.id },
      include: machineInclude,
    })
    if (!machine) throw ApiError.notFound('Mesin')
    res.json({ data: serializeMachine(machine) })
  }),
)

// POST /api/machines  (management: add machine)
machinesRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    const machine = await prisma.machine.create({
      data: {
        name: body.name,
        type: body.type.toUpperCase() as (typeof TYPES)[number],
        capacityKg: body.capacityKg,
        status: (body.status?.toUpperCase() as (typeof STATUSES)[number]) ?? 'IDLE',
        outletId: body.outletId,
      },
      include: machineInclude,
    })
    res.status(201).json({ data: serializeMachine(machine) })
  }),
)

// PATCH /api/machines/:id  (management: rename, capacity, status, type)
machinesRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>
    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        capacityKg: body.capacityKg,
        outletId: body.outletId,
        ...(body.type ? { type: body.type.toUpperCase() as (typeof TYPES)[number] } : {}),
        ...(body.status ? { status: body.status.toUpperCase() as (typeof STATUSES)[number] } : {}),
      },
      include: machineInclude,
    })
    res.json({ data: serializeMachine(machine) })
  }),
)

// DELETE /api/machines/:id
machinesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.machine.delete({ where: { id: req.params.id } })
    res.status(204).end()
  }),
)

// POST /api/machines/:id/assign  { orderId, basket?, durationMin? }
// Load an order's basket (putih / hitam / satuan) into the machine, start it, and move the order to CUCI.
// Tanpa `basket` = seluruh order (perilaku lama).
machinesRouter.post(
  '/:id/assign',
  requireAuth,
  validate({
    body: z.object({
      orderId: z.string().min(1),
      basket: z.enum(['putih', 'hitam', 'satuan']).optional(),
      durationMin: z.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { orderId, basket, durationMin } = req.body as {
      orderId: string
      basket?: 'putih' | 'hitam' | 'satuan'
      durationMin?: number
    }

    const machine = await prisma.machine.findUnique({ where: { id: req.params.id } })
    if (!machine) throw ApiError.notFound('Mesin')
    const sameLoad = machine.currentOrderId === orderId && machine.currentBasket === (basket ?? null)
    if (machine.currentOrderId && !sameLoad) {
      throw ApiError.badRequest('Mesin sedang dipakai order lain')
    }
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw ApiError.notFound('Order')

    const updated = await prisma.$transaction(async (tx) => {
      // Basket yang sama pindah mesin (cuci → pengering) → bebaskan mesin sebelumnya.
      await tx.machine.updateMany({
        where: { currentOrderId: orderId, currentBasket: basket ?? null, id: { not: machine.id } },
        data: { currentOrderId: null, currentBasket: null, status: 'IDLE', startedAt: null, lastUsedAt: new Date() },
      })
      await tx.order.update({ where: { id: orderId }, data: { status: 'CUCI' } })
      return tx.machine.update({
        where: { id: machine.id },
        data: {
          currentOrderId: orderId,
          currentBasket: basket ?? null,
          status: 'RUNNING',
          startedAt: new Date(),
          durationMin: durationMin ?? machine.durationMin ?? (machine.type === 'DRYER' ? 45 : 32),
        },
        include: machineInclude,
      })
    })
    res.json({ data: serializeMachine(updated) })
  }),
)

// POST /api/machines/:id/release  — free the machine (cycle ended / moved on).
machinesRouter.post(
  '/:id/release',
  requireAuth,
  asyncHandler(async (req, res) => {
    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: { currentOrderId: null, currentBasket: null, status: 'IDLE', startedAt: null, lastUsedAt: new Date() },
      include: machineInclude,
    })
    res.json({ data: serializeMachine(machine) })
  }),
)

// POST /api/machines/:id/complete  — mark the running cycle done.
machinesRouter.post(
  '/:id/complete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: { status: 'DONE' },
      include: machineInclude,
    })
    res.json({ data: serializeMachine(machine) })
  }),
)

// POST /api/machines/:id/handoff  { toStatus? }
// Advance the held order to the next stage (default SETRIKA) and free the machine.
machinesRouter.post(
  '/:id/handoff',
  requireAuth,
  validate({
    body: z.object({
      toStatus: z.enum(['CUCI', 'SETRIKA', 'PACKING', 'SIAP_AMBIL', 'SELESAI']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const toStatus = (req.body.toStatus ?? 'SETRIKA') as
      | 'CUCI'
      | 'SETRIKA'
      | 'PACKING'
      | 'SIAP_AMBIL'
      | 'SELESAI'
    const machine = await prisma.machine.findUnique({
      where: { id: req.params.id },
      include: { currentOrder: { select: { needsIron: true, sortedLoad: true } } },
    })
    if (!machine) throw ApiError.notFound('Mesin')

    // Cuci-only orders (needsIron=false) skip Setrika → straight to Packing.
    const next =
      toStatus === 'SETRIKA' && machine.currentOrder && !machine.currentOrder.needsIron
        ? 'PACKING'
        : toStatus

    const updated = await prisma.$transaction(async (tx) => {
      const orderId = machine.currentOrderId
      if (orderId) {
        const basket = machine.currentBasket as 'putih' | 'hitam' | 'satuan' | null
        let advance: boolean
        if (basket) {
          // Tandai basket ini selesai cuci-kering; order naik tahap kalau semua basket berisi sudah selesai.
          const load = (machine.currentOrder?.sortedLoad ?? {}) as Record<string, SortBasket | undefined>
          load[basket] = { ...(load[basket] ?? { items: [] }), doneAt: new Date().toISOString() }
          await tx.order.update({ where: { id: orderId }, data: { sortedLoad: load as Prisma.InputJsonValue } })
          advance = (['putih', 'hitam', 'satuan'] as const).every((key) => basketQty(load[key]) === 0 || !!load[key]?.doneAt)
        } else {
          // Order lama (tanpa basket): naik kalau tidak ada mesin lain yang memegangnya.
          advance = (await tx.machine.count({ where: { currentOrderId: orderId, id: { not: machine.id } } })) === 0
        }
        if (advance) await tx.order.update({ where: { id: orderId }, data: { status: next } })
      }
      return tx.machine.update({
        where: { id: machine.id },
        data: { currentOrderId: null, currentBasket: null, status: 'IDLE', startedAt: null, lastUsedAt: new Date() },
        include: machineInclude,
      })
    })
    res.json({ data: serializeMachine(updated) })
  }),
)

// ── Operasi per basket: satu basket (putih / hitam / satuan) bisa dipegang beberapa mesin ──
const loadKey = z.object({
  orderId: z.string().min(1),
  basket: z.enum(['putih', 'hitam', 'satuan']).optional(), // kosong = order lama tanpa basket
})
type LoadKey = z.infer<typeof loadKey>
const loadWhere = ({ orderId, basket }: LoadKey) => ({ currentOrderId: orderId, currentBasket: basket ?? null })
const FREE = { currentOrderId: null, currentBasket: null, status: 'IDLE' as const, startedAt: null }

// POST /api/machines/load  { orderId, basket?, machineIds[], durationMin? }
// Set mesin yang memegang basket ini = persis `machineIds` (semua satu jenis). Mesin lama basket ini
// (mis. mesin cuci saat pindah ke pengering) dibebaskan. Order → CUCI.
machinesRouter.post(
  '/load',
  requireAuth,
  validate({
    body: loadKey.extend({
      machineIds: z.array(z.string().min(1)).min(1, 'Pilih minimal satu mesin'),
      durationMin: z.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as LoadKey & { machineIds: string[]; durationMin?: number }
    const targets = await prisma.machine.findMany({ where: { id: { in: body.machineIds } } })
    if (targets.length !== new Set(body.machineIds).size) throw ApiError.notFound('Mesin')
    if (new Set(targets.map((m) => m.type)).size > 1) throw ApiError.badRequest('Mesin harus satu jenis')
    for (const m of targets) {
      if (m.status === 'MAINTENANCE') throw ApiError.badRequest(`${m.name} sedang perbaikan`)
      const sameLoad = m.currentOrderId === body.orderId && m.currentBasket === (body.basket ?? null)
      if (m.currentOrderId && !sameLoad) throw ApiError.badRequest(`${m.name} sedang dipakai order lain`)
    }
    if (!(await prisma.order.findUnique({ where: { id: body.orderId } }))) throw ApiError.notFound('Order')

    const updated = await prisma.$transaction(async (tx) => {
      await tx.machine.updateMany({
        where: { ...loadWhere(body), id: { notIn: body.machineIds } },
        data: { ...FREE, lastUsedAt: new Date() },
      })
      await tx.order.update({ where: { id: body.orderId }, data: { status: 'CUCI' } })
      return Promise.all(
        targets.map((m) =>
          tx.machine.update({
            where: { id: m.id },
            data: {
              currentOrderId: body.orderId,
              currentBasket: body.basket ?? null,
              status: 'RUNNING',
              startedAt: new Date(),
              durationMin: body.durationMin ?? m.durationMin ?? (m.type === 'DRYER' ? 45 : 32),
            },
            include: machineInclude,
          }),
        ),
      )
    })
    res.json({ data: updated.map(serializeMachine) })
  }),
)

// POST /api/machines/load/done  { orderId, basket? } — siklus semua mesin basket ini selesai.
// (Bukan /load/complete: path itu tertangkap route /:id/complete di atas.)
machinesRouter.post(
  '/load/done',
  requireAuth,
  validate({ body: loadKey }),
  asyncHandler(async (req, res) => {
    const result = await prisma.machine.updateMany({ where: loadWhere(req.body as LoadKey), data: { status: 'DONE' } })
    res.json({ data: { count: result.count } })
  }),
)

// POST /api/machines/load/finish  { orderId, basket?, toStatus? }
// Basket selesai cuci-kering: lepas semua mesinnya, tandai `doneAt`; order naik tahap
// (default SETRIKA, atau PACKING kalau needsIron=false) kalau semua basket berisi sudah selesai.
machinesRouter.post(
  '/load/finish',
  requireAuth,
  validate({ body: loadKey.extend({ toStatus: z.enum(['SETRIKA', 'PACKING']).optional() }) }),
  asyncHandler(async (req, res) => {
    const body = req.body as LoadKey & { toStatus?: 'SETRIKA' | 'PACKING' }
    const order = await prisma.order.findUnique({ where: { id: body.orderId } })
    if (!order) throw ApiError.notFound('Order')
    const toStatus = body.toStatus ?? 'SETRIKA'
    const next = toStatus === 'SETRIKA' && !order.needsIron ? 'PACKING' : toStatus

    const advanced = await prisma.$transaction(async (tx) => {
      await tx.machine.updateMany({ where: loadWhere(body), data: { ...FREE, lastUsedAt: new Date() } })
      let advance: boolean
      if (body.basket) {
        const load = (order.sortedLoad ?? {}) as Record<string, SortBasket | undefined>
        load[body.basket] = { ...(load[body.basket] ?? { items: [] }), doneAt: new Date().toISOString() }
        await tx.order.update({ where: { id: order.id }, data: { sortedLoad: load as Prisma.InputJsonValue } })
        advance = (['putih', 'hitam', 'satuan'] as const).every((key) => basketQty(load[key]) === 0 || !!load[key]?.doneAt)
      } else {
        advance = (await tx.machine.count({ where: { currentOrderId: order.id } })) === 0
      }
      if (advance) await tx.order.update({ where: { id: order.id }, data: { status: next } })
      return advance
    })
    res.json({ data: { advanced, status: advanced ? next : order.status } })
  }),
)
