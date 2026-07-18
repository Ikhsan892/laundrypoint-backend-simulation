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

// POST /api/machines/:id/assign  { orderId, durationMin? }
// Load an order into the machine, start it, and move the order to CUCI.
machinesRouter.post(
  '/:id/assign',
  requireAuth,
  validate({ body: z.object({ orderId: z.string().min(1), durationMin: z.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const { orderId, durationMin } = req.body as { orderId: string; durationMin?: number }

    const machine = await prisma.machine.findUnique({ where: { id: req.params.id } })
    if (!machine) throw ApiError.notFound('Mesin')
    if (machine.currentOrderId && machine.currentOrderId !== orderId) {
      throw ApiError.badRequest('Mesin sedang dipakai order lain')
    }
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw ApiError.notFound('Order')

    const updated = await prisma.$transaction(async (tx) => {
      // Free any machine that previously held this order (unique constraint).
      await tx.machine.updateMany({
        where: { currentOrderId: orderId, id: { not: machine.id } },
        data: { currentOrderId: null, status: 'IDLE', lastUsedAt: new Date() },
      })
      await tx.order.update({ where: { id: orderId }, data: { status: 'CUCI' } })
      return tx.machine.update({
        where: { id: machine.id },
        data: {
          currentOrderId: orderId,
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
      data: { currentOrderId: null, status: 'IDLE', startedAt: null, lastUsedAt: new Date() },
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
