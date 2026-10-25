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
  package?: 'reguler' | 'sameday' // kosong = 3rd party
  active?: boolean
  duration?: string
  minQty?: number
  needsWash?: boolean // default true; false = "Setrika Saja" (skip Cuci)
  needsIron?: boolean // default true; false = "Cuci Saja" / non-kiloan (skip Setrika)
}

const UNIT_MAP = { kg: 'KG', pcs: 'PCS', m: 'METER', psg: 'PASANG' } as const
const PKG_MAP = { reguler: 'REGULER', sameday: 'SAMEDAY' } as const
const CAT_MAP = { kiloan: 'KILOAN', 'non-kiloan': 'NON_KILOAN', '3rd-party': 'THIRD_PARTY' } as const

// ── Daftar harga per 1 Januari 2025 (foto harga1–7) ──────────
// Tiap layanan punya harga Reguler (2 hari) & Sameday (4 jam) → jadi 2 Service
// (slug `reg-*` / `sd-*`). 3rd party tanpa paket.
// Baris: [slug, nama, emoji, hargaReguler, hargaSameday, extra] — null = tidak ada di paket itu.
type Row = [string, string, string, number | null, number | null, Partial<SvcSeed>?]

const KG: Partial<SvcSeed> = { unit: 'kg', step: 0.1, category: 'kiloan', needsIron: true }
const kiloanRows: Row[] = [
  ['aj-cuci-setrika', 'Antar Jemput · Cuci Setrika', '🚚', 11000, 18000, { ...KG, minQty: 5 }],
  ['aj-cuci-lipat', 'Antar Jemput · Cuci Lipat / Setrika', '🚚', 10000, 17000, { ...KG, minQty: 5 }],
  // ponytail: reguler tercetak 13.300/kg tapi total 3kg tertulis 40.000 — pakai 13.300.
  ['cuci-setrika-3', 'Cuci Setrika · min 3kg', '🧺', 13300, 20000, { ...KG, minQty: 3 }],
  ['cuci-setrika-5', 'Cuci Setrika · min 5kg', '🧺', 10000, 16000, { ...KG, minQty: 5 }],
  ['cuci-lipat-5', 'Cuci Lipat / Setrika · min 5kg', '🫧', 9000, 15000, { ...KG, minQty: 5 }],
]

// Pakaian satuan punya harga Gantung & Lipat → butuh setrika.
const IRON: Partial<SvcSeed> = { needsIron: true }
const NO_KILO = 'jika tidak disertai pakaian kiloan'
const satuanRows: Row[] = [
  ['kemeja-gantung', 'Kemeja / Celana / Kaos / Rok / Selendang', '👔', 30000, 35000, { ...IRON, subtitle: 'Gantung' }],
  ['jas-gantung', 'Jas / Jaket / Sweater / Gaun Mini Midi', '🧥', 35000, 40000, { ...IRON, subtitle: 'Gantung' }],
  ['gamis-gantung', 'Gamis / Gaun / Kebaya / Songket / Longtorso / Coat', '👗', 45000, 50000, { ...IRON, subtitle: 'Gantung' }],
  ['kemeja-lipat', 'Kemeja / Celana / Kaos / Rok / Selendang', '👔', 25000, 30000, { ...IRON, subtitle: 'Lipat' }],
  ['jas-lipat', 'Jas / Jaket / Sweater / Gaun Mini Midi', '🧥', 30000, 35000, { ...IRON, subtitle: 'Lipat' }],
  ['gamis-lipat', 'Gamis / Gaun / Kebaya / Songket / Longtorso / Coat', '👗', 40000, 45000, { ...IRON, subtitle: 'Lipat' }],
  ['mukena', '1 Set Mukena', '🧕', 25000, 30000, { subtitle: 'Lipat' }],
  ['sajadah-tipis', 'Sajadah Tipis', '🕌', 15000, 20000, { subtitle: 'Lipat' }],
  ['seprai-set', '1 Set Seprai (2 Sarung Bantal + 2 Sarung Guling)', '🛏', 25000, 30000, { subtitle: NO_KILO }],
  ['handuk-baju', 'Handuk / Baju / Celana / Sarung Bantal Sofa', '🧴', 15000, 20000, { subtitle: NO_KILO }],
  ['dasi-selendang', 'Dasi / Selendang', '🧣', 10000, 15000, { subtitle: NO_KILO }],

  // "Tidak termasuk dalam kiloan"
  // TODO(harga): reguler baris 1–6 ketutup pantulan di foto harga4 → 0 = nonaktif, isi manual.
  ['gaun-kebaya', 'Gaun / Kebaya / Songket / Longtorso', '👗', 0, 45000, { subtitle: 'Lipat' }],
  ['jas-tebal', 'Jas / Jaket Tebal / Jaket Jeans / Sweater Tebal / Coat', '🧥', 0, 35000, { subtitle: 'Lipat' }],
  ['sajadah-tebal', 'Sajadah Tebal', '🕌', 0, 30000, { subtitle: 'Lipat' }],
  ['topi', 'Topi', '🧢', 0, 15000],
  ['tas-ransel', 'Tas Ransel', '🎒', 0, 60000],
  ['tas-slempang', 'Tas Slempang', '👜', 0, 40000],
  ['handuk-selimut', 'Handuk Selimut & Lebar', '🧴', 35000, 40000],
  ['handuk-kimono', 'Handuk Kimono / Handuk Besar / Tebal', '🧴', 20000, 25000, { subtitle: 'Lipat' }],
  ['selimut-kecil', 'Selimut Kecil / Tipis', '🛏', 25000, 30000, { subtitle: 'Lipat' }],
  ['selimut-besar', 'Selimut Besar / Tebal', '🛏', 50000, 55000],
  ['duvet', 'Duvet Cover / Sofa Cover', '🛋', 25000, 30000],
  ['matras', 'Matras Kasur Anti Air', '🛏', 25000, 30000],
  ['seprai-s', '1 Set Seprai (2SB+2SG) & Bedcover Single (S)', '🛏', 35000, 45000, { subtitle: '120 × 200 × 35cm' }],
  ['seprai-m', '1 Set Seprai (2SB+2SG) & Bedcover Queen (M)', '🛏', 45000, 55000, { subtitle: '160 × 200 × 35cm' }],
  ['seprai-l', '1 Set Seprai (2SB+2SG) & Bedcover King (L)', '🛏', 55000, 65000, { subtitle: '180 × 200 × 35cm' }],
  ['seprai-xl', '1 Set Seprai (2SB+2SG) & Bedcover Extra King (XL)', '🛏', 65000, 75000, { subtitle: '200 × 200 × 35cm' }],
  ['keset-handuk', 'Keset Handuk', '🧽', 15000, 20000],
  ['keset-besar', 'Keset Besar / Foam Mat / Keset Karpet', '🧽', 25000, 30000],
  ['boneka-kecil', 'Boneka Kecil', '🧸', 15000, 25000],
  ['boneka-sedang', 'Boneka Sedang', '🧸', 25000, 35000],
  ['boneka-besar', 'Boneka Besar', '🧸', 50000, 60000],
  ['bantal-leher', 'Bantal Leher', '🛏', 20000, 25000],
  ['bantal-sofa-kecil', 'Bantal Sofa Kecil', '🛋', 25000, 30000],
  ['bantal-besar', 'Bantal / Guling / Bantal Sofa Besar', '🛏', 50000, null],
  ['gordyn-kecil', 'Gordyn / Vitrase Kecil / Tipis', '🪟', 25000, 30000],
  ['gordyn-besar', 'Gordyn / Vitrase Besar / Tebal', '🪟', 30000, 35000, { unit: 'm', step: 0.5, subtitle: 'per meter' }],

  // Dry clean — reguler 3 hari, sameday 4 jam. Tanpa mesin cuci/setrika → langsung Packing.
  ['dc-jas-gantung', 'Dry Clean Jas / Jaket / Gamis / Kebaya / Songket / Coat', '✨', 70000, 80000, { subtitle: 'Gantung' }],
  ['dc-kemeja-gantung', 'Dry Clean Kemeja / Celana / Kaos / Rok / Rompi', '✨', 55000, 65000, { subtitle: 'Gantung' }],
  ['dc-jas-lipat', 'Dry Clean Jas / Jaket / Gamis / Kebaya / Songket / Coat', '✨', 65000, 75000, { subtitle: 'Lipat' }],
  ['dc-kemeja-lipat', 'Dry Clean Kemeja / Celana / Kaos / Rok / Rompi', '✨', 50000, 60000, { subtitle: 'Lipat' }],
  ['dc-sarung-bantal-sofa', 'Dry Clean Sarung Bantal Sofa', '✨', 25000, 30000, { subtitle: 'Lipat' }],
  ['dc-dasi', 'Dry Clean Dasi / Selendang', '✨', 20000, 25000, { subtitle: 'Lipat' }],
]
// Boneka Jumbo & Dry Clean Gaun "harga menyesuaikan" → tidak masuk katalog.

function expand(rows: Row[]): SvcSeed[] {
  return rows.flatMap(([slug, name, emoji, reg, sd, extra]) => {
    const dc = slug.startsWith('dc-')
    const common = {
      name,
      emoji,
      unit: 'pcs',
      step: 1,
      category: 'non-kiloan',
      needsIron: false, // satuan non-kiloan: default cuci saja
      ...(dc ? { needsWash: false } : {}),
      ...extra,
    } as Omit<SvcSeed, 'slug' | 'price'>
    const out: SvcSeed[] = []
    if (reg !== null) {
      out.push({
        ...common,
        slug: `reg-${slug}`,
        price: reg,
        package: 'reguler',
        active: reg > 0,
        ...(dc ? { duration: '3 hari' } : {}),
      })
    }
    if (sd !== null) out.push({ ...common, slug: `sd-${slug}`, price: sd, package: 'sameday' })
    return out
  })
}

// 3rd party: dikerjakan vendor luar → tanpa paket, lewati Cuci & Setrika (langsung Packing).
const VENDOR = { category: '3rd-party', needsWash: false, needsIron: false, subtitle: 'vendor partner' } as const
const thirdParty: SvcSeed[] = [
  { ...VENDOR, slug: 'sepatu', name: 'Sepatu', emoji: '👟', price: 70000, unit: 'psg', step: 1, duration: '3 hari' },
  { ...VENDOR, slug: 'sepatu-putih', name: 'Sepatu Putih', emoji: '👟', price: 80000, unit: 'psg', step: 1, duration: '3 hari' },
  { ...VENDOR, slug: 'karpet', name: 'Karpet', emoji: '🧵', price: 15000, unit: 'kg', step: 0.1, minQty: 3, duration: '5 hari' },
]

const catalog = [...expand(kiloanRows), ...expand(satuanRows), ...thirdParty]

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
        minQty: s.minQty ?? null,
        needsWash: s.needsWash ?? true,
        needsIron: s.needsIron ?? true,
        category: CAT_MAP[s.category],
        package: s.package ? PKG_MAP[s.package] : null,
        duration: s.duration,
        active: s.active ?? true,
      },
      update: {
        name: s.name,
        subtitle: s.subtitle,
        emoji: s.emoji,
        unit: UNIT_MAP[s.unit],
        step: s.step,
        category: CAT_MAP[s.category],
        package: s.package ? PKG_MAP[s.package] : null,
        duration: s.duration,
        active: s.active ?? true,
        price: s.price,
        minQty: s.minQty ?? null,
        needsWash: s.needsWash ?? true,
        needsIron: s.needsIron ?? true,
      },
    })
  }
  // Layanan lama (sebelum daftar harga per paket) dinonaktifkan, bukan dihapus — masih dirujuk OrderItem.
  await prisma.service.updateMany({
    where: { slug: { notIn: catalog.map((s) => s.slug) } },
    data: { active: false },
  })
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
