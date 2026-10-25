import { Router } from 'express'
import { z } from 'zod'
import type { Prisma, ServiceCategory, ServiceUnit } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { asyncHandler, ApiError } from '../../utils/http.js'
import { serializeOrder } from '../../utils/serializers.js'
import { fromUiUnit, fromUiCategory } from '../../utils/serializers.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { generateNoNota } from '../../utils/nota.js'

export const ordersRouter = Router()

const ORDER_STATUSES = [
  'ANTRIAN',
  'CUCI',
  'SETRIKA',
  'PACKING',
  'SIAP_AMBIL',
  'SELESAI',
  'BATAL',
] as const

const orderInclude = {
  items: true,
  payments: true,
  customer: true,
  cashier: true,
  adjustments: { orderBy: { createdAt: 'desc' }, take: 10 },
} satisfies Prisma.OrderInclude

// ── Schemas ───────────────────────────────────────────────────

const itemSchema = z.object({
  serviceId: z.string().optional(),
  name: z.string().min(1),
  subtitle: z.string().optional(),
  price: z.number().int().nonnegative(),
  unit: z.string().min(1), // 'kg' | 'pcs' | 'm' | 'psg'
  category: z.string().min(1), // 'kiloan' | 'non-kiloan' | '3rd-party'
  duration: z.string().optional(),
  qty: z.number().positive(),
})

const createSchema = z
  .object({
    // customer: either an existing id, or inline details to upsert by phone
    customerId: z.string().optional(),
    customer: z
      .object({
        name: z.string().min(1),
        phone: z.string().min(3),
        memberLabel: z.string().optional(),
        discountPct: z.number().int().min(0).max(100).default(0),
      })
      .optional(),
    cashierId: z.string().optional(),
    outletId: z.string().optional(),
    items: z.array(itemSchema).min(1, 'Minimal 1 item'),
    notes: z.string().optional(),
    delivery: z.boolean().default(false),
    package: z.enum(['reguler', 'sameday']).nullable().optional(), // 1 nota = 1 paket
    scalePhoto: z.string().optional(), // foto timbangan (base64)
    estimasi: z.string().optional(),
    estimatedAt: z.coerce.date().optional(),
    discountPct: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => v.customerId || v.customer, {
    message: 'customerId atau customer wajib diisi',
  })

const listQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(['BELUM_BAYAR', 'LUNAS']).optional(),
  customerId: z.string().optional(),
  q: z.string().optional(), // nota search
})

const paymentSchema = z.object({
  method: z.enum(['CASH', 'QRIS_BTN', 'QRIS_GOPAY', 'TRANSFER']),
  timing: z.enum(['NOW', 'PICKUP']).default('NOW'),
  cashReceived: z.number().int().nonnegative().optional(),
})

// ── Helpers ───────────────────────────────────────────────────

/** Resolve or create the customer for an order. */
async function resolveCustomer(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof createSchema>,
) {
  if (input.customerId) {
    const existing = await tx.customer.findUnique({ where: { id: input.customerId } })
    if (!existing) throw ApiError.notFound('Pelanggan')
    return existing
  }
  const c = input.customer!
  // upsert by phone so repeat customers are not duplicated
  return tx.customer.upsert({
    where: { phone: c.phone },
    create: {
      name: c.name,
      phone: c.phone,
      memberTier: c.memberLabel,
      discountPct: c.discountPct,
    },
    update: { name: c.name, memberTier: c.memberLabel, discountPct: c.discountPct },
  })
}

// ── Routes ────────────────────────────────────────────────────

// GET /api/orders — list / kanban board.
ordersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { status, paymentStatus, customerId, q } = req.query as z.infer<typeof listQuery>
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(customerId ? { customerId } : {}),
      ...(q ? { noNota: { contains: q, mode: 'insensitive' } } : {}),
    }
    const orders = await prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ data: orders.map(serializeOrder) })
  }),
)

// GET /api/orders/:id
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    })
    if (!order) throw ApiError.notFound('Order')
    res.json({ data: serializeOrder(order) })
  }),
)

// POST /api/orders — create from cart (the "Lanjut ke Pembayaran" flow).
ordersRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>

    const order = await prisma.$transaction(async (tx) => {
      const customer = await resolveCustomer(tx, body)
      const discountPct = body.discountPct ?? customer.discountPct ?? 0

      // Routing flags — computed from the services in the cart.
      // Setrika Saja → needsWash false (skip Cuci); Cuci Saja / non-kiloan → needsIron false (skip Setrika).
      let needsWash = false
      let needsIron = false

      // Build line items — prefer the authoritative Service price when linked.
      const lineItems = await Promise.all(
        body.items.map(async (i) => {
          const unit = fromUiUnit(i.unit)
          const category = fromUiCategory(i.category)
          if (!unit) throw ApiError.badRequest(`Unit tidak valid: ${i.unit}`)
          if (!category) throw ApiError.badRequest(`Kategori tidak valid: ${i.category}`)

          let price = i.price
          if (i.serviceId) {
            const svc = await tx.service.findUnique({ where: { id: i.serviceId } })
            if (svc) {
              price = svc.price
              if (svc.needsWash) needsWash = true
              if (svc.needsIron) needsIron = true
            } else {
              needsWash = true
              needsIron = true
            }
          } else {
            // custom item without a service → assume full flow
            needsWash = true
            needsIron = true
          }
          const lineTotal = Math.round(price * i.qty)
          return {
            serviceId: i.serviceId ?? null,
            name: i.name,
            subtitle: i.subtitle ?? null,
            price,
            unit: unit as ServiceUnit,
            category: category as ServiceCategory,
            duration: i.duration ?? null,
            qty: i.qty,
            lineTotal,
          }
        }),
      )

      const subtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0)
      const discount = Math.round((subtotal * discountPct) / 100)
      const total = subtotal - discount
      const noNota = await generateNoNota()

      // Where the order enters the pipeline:
      //   needs wash → ANTRIAN (Cuci); else needs iron → SETRIKA; else straight to PACKING.
      const status = needsWash ? 'ANTRIAN' : needsIron ? 'SETRIKA' : 'PACKING'

      return tx.order.create({
        data: {
          noNota,
          outletId: body.outletId,
          customerId: customer.id,
          cashierId: body.cashierId ?? req.auth!.sub,
          status,
          needsWash,
          needsIron,
          notes: body.notes,
          delivery: body.delivery,
          package: body.package ? (body.package.toUpperCase() as 'REGULER' | 'SAMEDAY') : null,
          scalePhoto: body.scalePhoto,
          discountPct,
          subtotal,
          discount,
          total,
          estimasi: body.estimasi,
          estimatedAt: body.estimatedAt,
          items: { create: lineItems },
        },
        include: orderInclude,
      })
    })

    res.status(201).json({ data: serializeOrder(order) })
  }),
)

// PATCH /api/orders/:id/status — move kanban stage.
ordersRouter.patch(
  '/:id/status',
  requireAuth,
  validate({ body: z.object({ status: z.enum(ORDER_STATUSES) }) }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
      include: orderInclude,
    })
    res.json({ data: serializeOrder(order) })
  }),
)

// PATCH /api/orders/:id/sort — save the "Cek & Pilah Cucian" result (baskets).
ordersRouter.patch(
  '/:id/sort',
  requireAuth,
  validate({ body: z.object({ sortedLoad: z.any() }) }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { sortedLoad: req.body.sortedLoad as Prisma.InputJsonValue },
      include: orderInclude,
    })
    res.json({ data: serializeOrder(order) })
  }),
)

// POST /api/orders/:id/payment — record payment (the "Selesaikan & cetak" flow).
ordersRouter.post(
  '/:id/payment',
  requireAuth,
  validate({ body: paymentSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof paymentSchema>
    const order = await prisma.order.findUnique({ where: { id: req.params.id } })
    if (!order) throw ApiError.notFound('Order')

    // Pelanggan baru (belum pernah order sebelumnya) wajib bayar di awal.
    if (body.timing === 'PICKUP' && order.customerId) {
      const prior = await prisma.order.count({
        where: { customerId: order.customerId, id: { not: order.id }, createdAt: { lt: order.createdAt } },
      })
      if (prior === 0) throw ApiError.badRequest('Pelanggan baru wajib bayar di awal')
    }

    if (body.timing === 'NOW' && body.method === 'CASH') {
      if (body.cashReceived != null && body.cashReceived < order.total) {
        throw ApiError.badRequest('Uang diterima kurang dari total')
      }
    }

    const change =
      body.cashReceived != null ? Math.max(0, body.cashReceived - order.total) : null

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: body.method,
          timing: body.timing,
          amount: order.total,
          cashReceived: body.cashReceived,
          change,
        },
      })
      return tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: body.timing === 'NOW' ? 'LUNAS' : 'BELUM_BAYAR' },
        include: orderInclude,
      })
    })

    res.status(201).json({ data: serializeOrder(updated), change })
  }),
)

// POST /api/orders/:id/pack — packing done → ready for pickup (SIAP_AMBIL) + rack.
ordersRouter.post(
  '/:id/pack',
  requireAuth,
  validate({
    body: z.object({
      rackLabel: z.string().max(40).optional(),
      packPhoto: z
        .string()
        .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Foto harus data URL gambar')
        .max(8_000_000)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { rackLabel?: string; packPhoto?: string }
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'SIAP_AMBIL', rackLabel: body.rackLabel, packPhoto: body.packPhoto },
      include: orderInclude,
    })
    res.json({ data: serializeOrder(order) })
  }),
)

// PATCH /api/orders/:id/rack — re-racking: pindahkan lokasi rak tanpa ubah status.
ordersRouter.patch(
  '/:id/rack',
  requireAuth,
  validate({ body: z.object({ rackLabel: z.string().min(1).max(40) }) }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { rackLabel: (req.body as { rackLabel: string }).rackLabel },
      include: orderInclude,
    })
    res.json({ data: serializeOrder(order) })
  }),
)

// POST /api/orders/:id/iron-photo — "Foto Hasil" documentation photo at Setrika.
ordersRouter.post(
  '/:id/iron-photo',
  requireAuth,
  validate({
    body: z.object({
      photo: z
        .string()
        .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Foto harus data URL gambar')
        .max(8_000_000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { ironPhoto: (req.body as { photo: string }).photo },
      include: orderInclude,
    })
    res.json({ data: serializeOrder(order) })
  }),
)

// POST /api/orders/:id/handover — hand to customer → SELESAI, settling an open
// bill first if a payment method is provided.
ordersRouter.post(
  '/:id/handover',
  requireAuth,
  validate({
    body: z.object({
      method: z.enum(['CASH', 'QRIS_BTN', 'QRIS_GOPAY', 'TRANSFER']).optional(),
      cashReceived: z.number().int().nonnegative().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { method?: string; cashReceived?: number }
    const order = await prisma.order.findUnique({ where: { id: req.params.id } })
    if (!order) throw ApiError.notFound('Order')

    if (order.paymentStatus !== 'LUNAS' && !body.method) {
      throw ApiError.badRequest('Order belum lunas — pilih metode pembayaran')
    }
    if (body.method === 'CASH' && body.cashReceived != null && body.cashReceived < order.total) {
      throw ApiError.badRequest('Uang diterima kurang dari total')
    }
    const change =
      body.method === 'CASH' && body.cashReceived != null
        ? Math.max(0, body.cashReceived - order.total)
        : null

    const updated = await prisma.$transaction(async (tx) => {
      if (order.paymentStatus !== 'LUNAS' && body.method) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            method: body.method as 'CASH' | 'QRIS_BTN' | 'QRIS_GOPAY' | 'TRANSFER',
            timing: 'NOW',
            amount: order.total,
            cashReceived: body.cashReceived,
            change,
          },
        })
      }
      return tx.order.update({
        where: { id: order.id },
        data: { status: 'SELESAI', paymentStatus: 'LUNAS' },
        include: orderInclude,
      })
    })
    res.json({ data: serializeOrder(updated), change })
  }),
)
