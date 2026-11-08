import type { PrismaClient } from '@prisma/client'

/** Barang awal per station (bisa ditambah dari aplikasi). Gas: pemakaian wajib pilih pengering. */
export const DEFAULT_INVENTORY: { station: string; name: string; unit: string; machineType?: 'DRYER' }[] = [
  { station: 'cuci', name: 'Sabun', unit: 'pouch' },
  { station: 'cuci', name: 'Softener', unit: 'pouch' },
  { station: 'cuci', name: 'Gas', unit: 'tabung', machineType: 'DRYER' },
  { station: 'packing', name: 'Plastik', unit: 'pcs' },
  { station: 'packing', name: 'Solasi', unit: 'roll' },
  { station: 'packing', name: 'Parfum', unit: 'botol' },
  { station: 'packing', name: 'Sticker', unit: 'lembar' },
  { station: 'packing', name: 'Gantungan', unit: 'pcs' },
  { station: 'kasir', name: 'Gantungan', unit: 'pcs' },
]

/** Pastikan barang awal ada tanpa perlu seed; yang sudah ada (termasuk yang dinonaktifkan) tidak disentuh. */
export const ensureDefaultInventory = (prisma: PrismaClient) =>
  prisma.inventoryItem.createMany({ data: DEFAULT_INVENTORY, skipDuplicates: true })
