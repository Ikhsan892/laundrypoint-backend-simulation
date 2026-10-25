import { Router } from 'express'
import { z } from 'zod'
import type { Shift } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler } from '../../utils/http.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const shiftsRouter = Router()

function serialize(s: Shift) {
  return {
    id: s.id,
    shiftNo: s.shiftNo,
    employeeId: s.employeeId,
    employeeName: s.employeeName,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    status: s.status,
  }
}

// GET /api/shifts/current — the currently open shift (or null).
shiftsRouter.get(
  '/current',
  asyncHandler(async (_req, res) => {
    const shift = await prisma.shift.findFirst({
      where: { status: 'open' },
      orderBy: { openedAt: 'desc' },
    })
    res.json({ data: shift ? serialize(shift) : null })
  }),
)

// POST /api/shifts/open — open a shift (closes any currently-open one first).
shiftsRouter.post(
  '/open',
  requireAuth,
  validate({
    body: z.object({
      shiftNo: z.number().int().min(1).max(3),
      employeeId: z.string().optional(),
      employeeName: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { shiftNo: number; employeeId?: string; employeeName?: string }
    const shift = await prisma.$transaction(async (tx) => {
      await tx.shift.updateMany({ where: { status: 'open' }, data: { status: 'closed', closedAt: new Date() } })
      return tx.shift.create({
        data: {
          shiftNo: body.shiftNo,
          employeeId: body.employeeId,
          employeeName: body.employeeName,
        },
      })
    })
    res.status(201).json({ data: serialize(shift) })
  }),
)

// POST /api/shifts/close — close the currently open shift.
shiftsRouter.post(
  '/close',
  requireAuth,
  asyncHandler(async (_req, res) => {
    await prisma.shift.updateMany({
      where: { status: 'open' },
      data: { status: 'closed', closedAt: new Date() },
    })
    res.json({ ok: true })
  }),
)
