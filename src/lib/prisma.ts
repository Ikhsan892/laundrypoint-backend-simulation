import { PrismaClient } from '@prisma/client'
import { isProd } from '../config/env.js'

// Reuse a single client across hot-reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  })

if (!isProd) globalForPrisma.prisma = prisma
