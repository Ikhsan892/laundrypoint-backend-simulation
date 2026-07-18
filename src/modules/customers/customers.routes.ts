import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeCustomer } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'

export const customersRouter = Router()

const listQuery = z.object({
  q: z.string().optional(), // search name or phone
})

const bodySchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(3),
  memberLabel: z.string().optional(),
  discountPct: z.number().int().min(0).max(100).default(0),
})

// GET /api/customers?q=
customersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { q } = req.query as z.infer<typeof listQuery>
    const where: Prisma.CustomerWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : {}
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 50,
    })
    res.json({ data: customers.map(serializeCustomer) })
  }),
)

// GET /api/customers/:id (with order history)
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 20 } },
    })
    if (!customer) throw ApiError.notFound('Pelanggan')
    res.json({ data: { ...serializeCustomer(customer), orders: customer.orders } })
  }),
)

// POST /api/customers
customersRouter.post(
  '/',
  requireAuth,
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bodySchema>
    const customer = await prisma.customer.create({
      data: {
        name: body.name,
        phone: body.phone,
        memberTier: body.memberLabel,
        discountPct: body.discountPct,
      },
    })
    res.status(201).json({ data: serializeCustomer(customer) })
  }),
)

// PATCH /api/customers/:id
customersRouter.patch(
  '/:id',
  requireAuth,
  validate({ body: bodySchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof bodySchema>>
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        phone: body.phone,
        memberTier: body.memberLabel,
        discountPct: body.discountPct,
      },
    })
    res.json({ data: serializeCustomer(customer) })
  }),
)
