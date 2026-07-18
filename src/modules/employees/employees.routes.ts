import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeEmployee } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const employeesRouter = Router()

const ROLES = ['KASIR', 'CUCI_KERING', 'SETRIKA', 'PACKING', 'OWNER'] as const
const STATUSES = ['ONLINE', 'WORKING', 'OFFLINE'] as const

const listQuery = z.object({
  outletId: z.string().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().optional(),
})

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  pin: z.string().regex(/^\d{4,6}$/),
  role: z.enum(ROLES),
  color: z.string().optional(),
  note: z.string().optional(),
  avatarUrl: z.string().optional(),
  outletId: z.string().optional(),
})

const updateSchema = createSchema.partial().extend({
  status: z.enum(STATUSES).optional(),
})

// GET /api/employees — list (used by AccountSelect).
employeesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { outletId, role, status, q } = req.query as z.infer<typeof listQuery>
    const where: Prisma.EmployeeWhereInput = {
      ...(outletId ? { outletId } : {}),
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    }
    const employees = await prisma.employee.findMany({ where, orderBy: { name: 'asc' } })
    res.json({ data: employees.map(serializeEmployee) })
  }),
)

// GET /api/employees/:id
employeesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } })
    if (!employee) throw ApiError.notFound('Pegawai')
    res.json({ data: serializeEmployee(employee) })
  }),
)

// POST /api/employees
employeesRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>
    const employee = await prisma.employee.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: body.password ? await bcrypt.hash(body.password, 10) : undefined,
        pinHash: await bcrypt.hash(body.pin, 10),
        role: body.role,
        color: body.color,
        note: body.note,
        avatarUrl: body.avatarUrl,
        outletId: body.outletId,
      },
    })
    res.status(201).json({ data: serializeEmployee(employee) })
  }),
)

// PATCH /api/employees/:id
employeesRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        email: body.email,
        role: body.role,
        status: body.status,
        color: body.color,
        note: body.note,
        avatarUrl: body.avatarUrl,
        outletId: body.outletId,
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10) } : {}),
        ...(body.pin ? { pinHash: await bcrypt.hash(body.pin, 10) } : {}),
      },
    })
    res.json({ data: serializeEmployee(employee) })
  }),
)

// PATCH /api/employees/:id/status — quick status toggle.
employeesRouter.patch(
  '/:id/status',
  requireAuth,
  validate({ body: z.object({ status: z.enum(STATUSES) }) }),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { status: req.body.status, lastSeenAt: new Date() },
    })
    res.json({ data: serializeEmployee(employee) })
  }),
)

// DELETE /api/employees/:id
employeesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.employee.delete({ where: { id: req.params.id } })
    res.status(204).end()
  }),
)
