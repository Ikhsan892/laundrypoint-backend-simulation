// Map Prisma enums <-> the string shapes the cashier frontend uses.
import type {
  Customer,
  Employee,
  Machine,
  Order,
  OrderAdjustment,
  OrderItem,
  Payment,
  Service,
  ServiceCategory,
  ServiceUnit,
} from '@prisma/client'

// ── Unit ──────────────────────────────────────────────────────
const UNIT_TO_UI: Record<ServiceUnit, string> = {
  KG: 'kg',
  PCS: 'pcs',
  METER: 'm',
  PASANG: 'psg',
}
const UI_TO_UNIT: Record<string, ServiceUnit> = {
  kg: 'KG',
  pcs: 'PCS',
  m: 'METER',
  meter: 'METER',
  psg: 'PASANG',
  pasang: 'PASANG',
}

// ── Category ──────────────────────────────────────────────────
const CATEGORY_TO_UI: Record<ServiceCategory, string> = {
  KILOAN: 'kiloan',
  NON_KILOAN: 'non-kiloan',
  THIRD_PARTY: '3rd-party',
}
const UI_TO_CATEGORY: Record<string, ServiceCategory> = {
  kiloan: 'KILOAN',
  'non-kiloan': 'NON_KILOAN',
  '3rd-party': 'THIRD_PARTY',
}

// ── Role ──────────────────────────────────────────────────────
const ROLE_TO_UI: Record<string, string> = {
  KASIR: 'Kasir',
  CUCI_KERING: 'Cuci / Kering',
  SETRIKA: 'Setrika',
  PACKING: 'Packing',
  OWNER: 'Owner',
}

export const toUiUnit = (u: ServiceUnit) => UNIT_TO_UI[u]
export const fromUiUnit = (u: string): ServiceUnit | undefined => UI_TO_UNIT[u.toLowerCase()]
export const toUiCategory = (c: ServiceCategory) => CATEGORY_TO_UI[c]
export const fromUiCategory = (c: string): ServiceCategory | undefined =>
  UI_TO_CATEGORY[c.toLowerCase()]

export function serializeService(s: Service) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    subtitle: s.subtitle,
    emoji: s.emoji,
    price: s.price,
    unit: toUiUnit(s.unit),
    step: s.step,
    category: toUiCategory(s.category),
    duration: s.duration,
    active: s.active,
  }
}

export function serializeEmployee(e: Employee) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    role: ROLE_TO_UI[e.role] ?? e.role,
    roleKey: e.role,
    status: e.status.toLowerCase(),
    color: e.color,
    note: e.note,
    avatarUrl: e.avatarUrl,
    lastSeen: e.lastSeenAt,
    outletId: e.outletId,
  }
}

export function serializeCustomer(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    memberLabel: c.memberTier,
    discountPct: c.discountPct,
  }
}

function serializeItem(i: OrderItem) {
  return {
    id: i.id,
    serviceId: i.serviceId,
    name: i.name,
    subtitle: i.subtitle,
    price: i.price,
    unit: toUiUnit(i.unit),
    category: toUiCategory(i.category),
    duration: i.duration,
    qty: i.qty,
    lineTotal: i.lineTotal,
  }
}

function serializePayment(p: Payment) {
  return {
    id: p.id,
    method: p.method.toLowerCase(),
    timing: p.timing.toLowerCase(),
    amount: p.amount,
    cashReceived: p.cashReceived,
    change: p.change,
    paidAt: p.paidAt,
  }
}

export function serializeAdjustment(a: OrderAdjustment) {
  return {
    id: a.id,
    orderId: a.orderId,
    status: a.status.toLowerCase(), // 'pending' | 'approved' | 'rejected'
    reason: a.reason,
    changes: a.changes,
    requestedById: a.requestedById,
    requestedByName: a.requestedByName,
    reviewedById: a.reviewedById,
    reviewedByName: a.reviewedByName,
    reviewedAt: a.reviewedAt,
    createdAt: a.createdAt,
  }
}

type OrderWithRelations = Order & {
  items?: OrderItem[]
  payments?: Payment[]
  customer?: Customer | null
  cashier?: Employee | null
  adjustments?: OrderAdjustment[]
}

type MachineWithOrder = Machine & { currentOrder?: (Order & { customer?: Customer | null }) | null }

export function serializeMachine(m: MachineWithOrder) {
  const order = m.currentOrder
  return {
    id: m.id,
    name: m.name,
    type: m.type.toLowerCase(), // 'washer' | 'dryer'
    status: m.status.toLowerCase(), // 'idle' | 'running' | 'done' | 'maintenance'
    capacityKg: m.capacityKg,
    outletId: m.outletId,
    startedAt: m.startedAt,
    durationMin: m.durationMin,
    lastUsedAt: m.lastUsedAt,
    currentOrderId: m.currentOrderId,
    currentOrder: order
      ? {
          id: order.id,
          noNota: order.noNota,
          customerName: order.customer?.name ?? null,
        }
      : null,
  }
}

export function serializeOrder(o: OrderWithRelations) {
  return {
    id: o.id,
    noNota: o.noNota,
    status: o.status,
    paymentStatus: o.paymentStatus,
    notes: o.notes,
    delivery: o.delivery,
    discountPct: o.discountPct,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    estimasi: o.estimasi,
    estimatedAt: o.estimatedAt,
    sortedLoad: o.sortedLoad ?? null,
    outletId: o.outletId,
    customerId: o.customerId,
    cashierId: o.cashierId,
    customer: o.customer ? serializeCustomer(o.customer) : null,
    cashier: o.cashier ? serializeEmployee(o.cashier) : null,
    items: o.items?.map(serializeItem) ?? [],
    payments: o.payments?.map(serializePayment) ?? [],
    adjustments: o.adjustments?.map(serializeAdjustment) ?? [],
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}
