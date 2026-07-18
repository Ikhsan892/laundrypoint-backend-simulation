import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeEmployee } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, signToken } from '../../middleware/auth.js'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const pinSchema = z.object({
  employeeId: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN harus 4–6 digit angka'),
})

// POST /api/auth/login — outlet/admin login with email + password.
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const employee = await prisma.employee.findUnique({ where: { email } })
    if (!employee?.passwordHash) throw ApiError.unauthorized('Email atau password salah')

    const ok = await bcrypt.compare(password, employee.passwordHash)
    if (!ok) throw ApiError.unauthorized('Email atau password salah')

    const token = signToken({ sub: employee.id, role: employee.role, scope: 'admin' })
    res.json({ token, employee: serializeEmployee(employee) })
  }),
)

// POST /api/auth/pin — station login: pick employee, enter 4-digit PIN.
authRouter.post(
  '/pin',
  validate({ body: pinSchema }),
  asyncHandler(async (req, res) => {
    const { employeeId, pin } = req.body as z.infer<typeof pinSchema>
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
    if (!employee) throw ApiError.notFound('Pegawai')

    const ok = await bcrypt.compare(pin, employee.pinHash)
    if (!ok) throw ApiError.unauthorized('PIN salah')

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: { status: 'ONLINE', lastSeenAt: new Date() },
    })

    const token = signToken({ sub: employee.id, role: employee.role, scope: 'station' })
    res.json({ token, employee: serializeEmployee(updated) })
  }),
)

// GET /api/auth/me — current session's employee.
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({ where: { id: req.auth!.sub } })
    if (!employee) throw ApiError.notFound('Pegawai')
    res.json({ employee: serializeEmployee(employee), scope: req.auth!.scope })
  }),
)

// POST /api/auth/logout — mark employee offline.
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.employee.update({
      where: { id: req.auth!.sub },
      data: { status: 'OFFLINE', lastSeenAt: new Date() },
    })
    res.json({ ok: true })
  }),
)
