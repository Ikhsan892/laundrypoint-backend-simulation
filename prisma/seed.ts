import { PrismaClient, type EmployeeRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEFAULT_PIN = '1234' // matches the mock PIN in the cashier UI

// ── Employees (from AccountSelect.vue) ────────────────────────
const ROLE_MAP: Record<string, EmployeeRole> = {
  Kasir: 'KASIR',
  'Cuci / Kering': 'CUCI_KERING',
  Setrika: 'SETRIKA',
  Packing: 'PACKING',
  Owner: 'OWNER',
}

const employees = [
  { id: 'emp-1', name: 'Rizky Andriansyah', role: 'Cuci / Kering', status: 'ONLINE', color: '#5b9df9' },
  { id: 'emp-2', name: 'Sinta Devani', role: 'Kasir', status: 'WORKING', color: '#f0a44a', email: 'sinta@laundrypoint.id' },
  { id: 'emp-3', name: 'Yudi Prasetyo', role: 'Cuci / Kering', status: 'OFFLINE', color: '#93c5fd' },
  { id: 'emp-4', name: 'Mira Kusuma', role: 'Setrika', status: 'ONLINE', color: '#f0684a' },
  { id: 'emp-5', name: 'Bayu Setiawan', role: 'Packing', status: 'WORKING', color: '#f472b6' },
  { id: 'emp-6', name: 'Rina Widiastuti', role: 'Kasir', status: 'WORKING', color: '#fb923c', email: 'rina@laundrypoint.id' },
  { id: 'emp-7', name: 'Adit Hardiansyah', role: 'Setrika', status: 'WORKING', color: '#f97316' },
  { id: 'emp-8', name: 'Lina Pratama', role: 'Owner', status: 'ONLINE', color: '#a855f7', email: 'owner@laundrypoint.id', password: 'owner123', note: 'Akses semua outlet' },
] as const

// ── Service catalog (from Entry/Cashier.vue) ──────────────────
type SvcSeed = {
  slug: string
  name: string
  subtitle?: string
  emoji: string
  price: number
  unit: 'kg' | 'pcs' | 'm' | 'psg'
  step: number
  category: 'kiloan' | 'non-kiloan' | '3rd-party'
  duration?: string
}

const UNIT_MAP = { kg: 'KG', pcs: 'PCS', m: 'METER', psg: 'PASANG' } as const
const CAT_MAP = { kiloan: 'KILOAN', 'non-kiloan': 'NON_KILOAN', '3rd-party': 'THIRD_PARTY' } as const

const kiloan: SvcSeed[] = [
  { slug: 'reguler', name: 'Reguler', subtitle: '2–3 hari · cuci + setrika', emoji: '📋', price: 7000, unit: 'kg', step: 0.1, category: 'kiloan' },
  { slug: 'sameday', name: 'Sameday', subtitle: 'Selesai hari ini · maks 14:00', emoji: '🔥', price: 14000, unit: 'kg', step: 0.1, category: 'kiloan' },
  { slug: 'express', name: 'Express 1 Hari', subtitle: 'Selesai 24 jam', emoji: '🚀', price: 10000, unit: 'kg', step: 0.1, category: 'kiloan' },
  { slug: 'cuci-saja', name: 'Cuci Saja', subtitle: 'Tanpa setrika', emoji: '🫧', price: 5000, unit: 'kg', step: 0.1, category: 'kiloan' },
  { slug: 'setrika-saja', name: 'Setrika Saja', subtitle: 'Sudah dicuci sendiri', emoji: '🔥', price: 4000, unit: 'kg', step: 0.1, category: 'kiloan' },
  { slug: 'bayi', name: 'Bayi / Sensitif', subtitle: 'Sleek · tanpa parfum', emoji: '👶', price: 9000, unit: 'kg', step: 0.1, category: 'kiloan' },
]

const nonKiloanRaw: [string, string, string, number][] = [
  ['selimut', 'Selimut', '🛏', 15000],
  ['selimut-tebal', 'Selimut Tebal', '🛏', 20000],
  ['selimut-tipis', 'Selimut Tipis', '🛏', 12000],
  ['bedcover', 'Bedcover', '🛏', 25000],
  ['duvet', 'Duvet/Sofa', '🛋', 30000],
  ['cover-sofa', 'Cover Sofa', '🛋', 25000],
  ['gorden-tipis', 'Gorden Tipis /m', '🪟', 15000],
  ['gorden-tebal', 'Gorden Tebal /m', '🪟', 25000],
  ['vitrase', 'Vitrase /m', '🪟', 12000],
  ['keset', 'Keset', '🧽', 8000],
  ['keset-handuk', 'Keset Handuk', '🧽', 8000],
  ['keset-foam', 'Keset Foam', '🧽', 10000],
  ['sajadah', 'Sajadah', '🕌', 10000],
  ['mukena', 'Mukena', '🧕', 15000],
  ['jaket', 'Jaket', '🧥', 15000],
  ['jaket-sweater', 'Jaket / Sweater', '🧥', 15000],
  ['coat', 'Coat', '🧥', 30000],
  ['rompi', 'Rompi', '🦺', 12000],
  ['tas', 'Tas', '👜', 25000],
  ['topi', 'Topi', '🧢', 12000],
  ['dasi', 'Dasi', '👔', 8000],
  ['selendang', 'Selendang', '🧣', 10000],
  ['kebaya', 'Kebaya', '👗', 30000],
  ['songket', 'Songket', '👘', 40000],
  ['gamis', 'Gamis', '👘', 18000],
  ['gaun', 'Gaun', '👗', 25000],
  ['kimono', 'Kimono', '👘', 20000],
  ['jas', 'Jas', '🤵', 35000],
  ['longtorso', 'Longtorso', '👔', 25000],
  ['matras', 'Matras Anti Air', '🛏', 40000],
  ['handuk', 'Handuk', '🧴', 8000],
  ['handuk-besar', 'Handuk Besar', '🧴', 12000],
  ['handuk-kecil', 'Handuk Kecil', '🧴', 5000],
  ['bantal', 'Bantal / Guling', '🛏', 12000],
  ['sarung-bantal', 'Sarung Bantal / Sofa', '🛏', 6000],
  ['bantal-leher', 'Bantal Leher', '🛏', 10000],
  ['bantal-sofa-kecil', 'Bantal Sofa Kecil', '🛏', 12000],
  ['bantal-sofa-besar', 'Bantal Sofa Besar', '🛏', 18000],
  ['boneka-kecil', 'Boneka Kecil', '🧸', 15000],
  ['boneka-sedang', 'Boneka Sedang', '🧸', 25000],
  ['boneka-besar', 'Boneka Besar', '🧸', 40000],
  ['boneka-jumbo', 'Boneka Jumbo', '🧸', 60000],
]

const nonKiloan: SvcSeed[] = nonKiloanRaw.map(([slug, name, emoji, price]) => ({
  slug,
  name,
  emoji,
  price,
  subtitle: 'cuci terpisah · 50ml deterjen',
  unit: 'pcs',
  step: 1,
  category: 'non-kiloan',
}))

const thirdParty: SvcSeed[] = [
  { slug: 'karpet', name: 'Karpet /m', subtitle: 'vendor partner', emoji: '🧵', price: 20000, unit: 'm', step: 0.5, category: '3rd-party', duration: '7 hari' },
  { slug: 'sepatu', name: 'Sepatu /pasang', subtitle: 'vendor partner', emoji: '👟', price: 35000, unit: 'psg', step: 1, category: '3rd-party', duration: '3 hari' },
  { slug: 'dryclean', name: 'Dry Clean /pcs', subtitle: 'vendor partner', emoji: '✨', price: 20000, unit: 'pcs', step: 1, category: '3rd-party', duration: '3 hari' },
]

const catalog = [...kiloan, ...nonKiloan, ...thirdParty]

async function main() {
  console.log('🌱 Seeding Laundry Point...')

  const outlet = await prisma.outlet.upsert({
    where: { id: 'outlet-azolla' },
    create: {
      id: 'outlet-azolla',
      name: 'LAUNDRY POINT',
      address: 'Tower Cluster Azolla',
      phone: '0812-1111-2222',
      instagram: '@laundrypoint.id',
    },
    update: {},
  })
  console.log(`  ✔ Outlet: ${outlet.name}`)

  const pinHash = await bcrypt.hash(DEFAULT_PIN, 10)
  for (const e of employees) {
    const passwordHash = 'password' in e && e.password ? await bcrypt.hash(e.password, 10) : undefined
    await prisma.employee.upsert({
      where: { id: e.id },
      create: {
        id: e.id,
        name: e.name,
        email: 'email' in e ? e.email : undefined,
        passwordHash,
        pinHash,
        role: ROLE_MAP[e.role]!,
        status: e.status,
        color: e.color,
        note: 'note' in e ? (e.note as string) : undefined,
        outletId: outlet.id,
      },
      update: {},
    })
  }
  console.log(`  ✔ Employees: ${employees.length} (default PIN: ${DEFAULT_PIN})`)

  for (const s of catalog) {
    await prisma.service.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        name: s.name,
        subtitle: s.subtitle,
        emoji: s.emoji,
        price: s.price,
        unit: UNIT_MAP[s.unit],
        step: s.step,
        category: CAT_MAP[s.category],
        duration: s.duration,
      },
      update: { price: s.price },
    })
  }
  console.log(`  ✔ Services: ${catalog.length}`)

  // Machines: washers A/B/C + dryers 1/2 (matches the Cuci & Kering UI).
  const machines = [
    { id: 'mc-wa', name: 'Mesin Cuci A', type: 'WASHER', capacityKg: 8 },
    { id: 'mc-wb', name: 'Mesin Cuci B', type: 'WASHER', capacityKg: 8 },
    { id: 'mc-wc', name: 'Mesin Cuci C', type: 'WASHER', capacityKg: 12 },
    { id: 'mc-d1', name: 'Pengering 1', type: 'DRYER', capacityKg: 10 },
    { id: 'mc-d2', name: 'Pengering 2', type: 'DRYER', capacityKg: 10 },
  ] as const
  for (const m of machines) {
    await prisma.machine.upsert({
      where: { id: m.id },
      create: { id: m.id, name: m.name, type: m.type, capacityKg: m.capacityKg, outletId: outlet.id },
      update: {},
    })
  }
  console.log(`  ✔ Machines: ${machines.length}`)

  // A sample member customer (from the cashier's default customer).
  await prisma.customer.upsert({
    where: { phone: '0812-3456-7890' },
    create: { name: 'Ibu Wulan Sari', phone: '0812-3456-7890', memberTier: 'Member 5%', discountPct: 5 },
    update: {},
  })
  console.log('  ✔ Sample customer')

  console.log('✅ Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
