import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'

/** Nama karyawan dari id. */
export async function employeeName(employeeId?: string | null) {
  if (!employeeId) return null
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } })
  return employee?.name ?? null
}

/**
 * Siapa yang mengerjakan: petugas yang dipilih di station (header `X-Operator-Id`, diisi frontend dari
 * petugas yang sudah absen); kalau kosong, pemilik token.
 */
export async function actorName(req: Request) {
  return (await employeeName(req.header('x-operator-id'))) ?? (await employeeName(req.auth?.sub))
}
