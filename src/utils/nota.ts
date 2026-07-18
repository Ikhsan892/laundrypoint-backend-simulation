import { prisma } from '../lib/prisma.js'

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/**
 * Generate a unique nota number in the LP-DDMM-XXXX format used by the
 * cashier UI. Retries on the rare collision against the unique index.
 */
export async function generateNoNota(): Promise<string> {
  const d = new Date()
  const ddmm = pad(d.getDate()) + pad(d.getMonth() + 1)

  for (let attempt = 0; attempt < 10; attempt++) {
    const seq = pad(Math.floor(Math.random() * 10_000), 4)
    const candidate = `LP-${ddmm}-${seq}`
    const exists = await prisma.order.findUnique({
      where: { noNota: candidate },
      select: { id: true },
    })
    if (!exists) return candidate
  }
  // Fallback: timestamp-based, effectively collision-free.
  return `LP-${ddmm}-${Date.now().toString().slice(-6)}`
}
