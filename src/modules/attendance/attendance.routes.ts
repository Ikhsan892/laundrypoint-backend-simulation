import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import type { Attendance, Employee } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { serializeEmployee } from '../../utils/serializers.js'

export const attendanceRouter = Router()

const station = z.enum(['cashier', 'dry-and-clean', 'ironing', 'packing', 'pengembalian'])
// `since` = awal hari menurut jam tablet; absen hari sebelumnya tidak dihitung.
const since = z.string().datetime()

const serialize = (a: Attendance & { employee: Employee }) => ({
  id: a.id,
  station: a.station,
  checkInAt: a.checkInAt,
  employee: serializeEmployee(a.employee),
})

const activeWhere = (at: string, from: string) => ({ station: at, checkOutAt: null, checkInAt: { gte: new Date(from) } })

// GET /api/attendance?station=&since= — petugas yang sedang absen di station.
attendanceRouter.get(
  '/',
  validate({ query: z.object({ station, since }) }),
  asyncHandler(async (req, res) => {
    const { station: at, since: from } = req.query as { station: string; since: string }
    const list = await prisma.attendance.findMany({ where: activeWhere(at, from), include: { employee: true }, orderBy: { checkInAt: 'asc' } })
    res.json({ data: list.map(serialize) })
  }),
)

// POST /api/attendance  { station, since, employeeId, pin? } — absen masuk. Pegawai lain (bukan pemilik
// sesi) wajib memasukkan PIN-nya sendiri.
attendanceRouter.post(
  '/',
  requireAuth,
  validate({
    body: z.object({ station, since, employeeId: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { station: string; since: string; employeeId: string; pin?: string }
    const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } })
    if (!employee) throw ApiError.notFound('Pegawai')
    if (body.employeeId !== req.auth?.sub) {
      if (!body.pin) throw ApiError.badRequest('Masukkan PIN')
      if (!(await bcrypt.compare(body.pin, employee.pinHash))) throw ApiError.unauthorized('PIN salah')
    }
    const existing = await prisma.attendance.findFirst({ where: { ...activeWhere(body.station, body.since), employeeId: employee.id }, include: { employee: true } })
    if (existing) return res.json({ data: serialize(existing) })
    const created = await prisma.attendance.create({
      data: { station: body.station, employeeId: employee.id },
      include: { employee: true },
    })
    await prisma.employee.update({ where: { id: employee.id }, data: { status: 'WORKING', lastSeenAt: new Date() } })
    res.status(201).json({ data: serialize(created) })
  }),
)

// POST /api/attendance/:id/checkout — selesai bertugas di station ini.
attendanceRouter.post(
  '/:id/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const attendance = await prisma.attendance.update({
      where: { id: req.params.id },
      data: { checkOutAt: new Date() },
      include: { employee: true },
    })
    res.json({ data: serialize(attendance) })
  }),
)
