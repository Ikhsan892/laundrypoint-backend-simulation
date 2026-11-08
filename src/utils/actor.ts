import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'

/** Nama karyawan dari id. */
export async function employeeName(employeeId?: string | null) {
  if (!employeeId) return null
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } })
  return employee?.name ?? null
}

/**
 * Siapa yang mengerjakan: petugas yang dipilih di station (header `X-Operator-Id`, satu atau beberapa id
 * dipisah koma — satu nota bisa dikerjakan berdua); kalau kosong, pemilik token. Hasil: "Rizky, Adit".
 */
export async function actorName(req: Request) {
  const ids = (req.header('x-operator-id') ?? '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 10)
  if (ids.length) {
    const found = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    const names = ids.map((id) => found.find((e) => e.id === id)?.name).filter(Boolean)
    if (names.length) return names.join(', ')
  }
  return employeeName(req.auth?.sub)
}
