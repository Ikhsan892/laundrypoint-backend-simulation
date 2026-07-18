import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'

async function main() {
  // Fail fast if the database is unreachable.
  await prisma.$connect()
  const app = createApp()

  const server = app.listen(env.port, () => {
    console.log(`🧺 Laundry Point API listening on http://localhost:${env.port}`)
    console.log(`   Health: http://localhost:${env.port}/api/health`)
  })

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down...`)
    server.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(async (err) => {
  console.error('Failed to start server:', err)
  await prisma.$disconnect()
  process.exit(1)
})
