import 'dotenv/config'

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
}

export const isProd = env.nodeEnv === 'production'
