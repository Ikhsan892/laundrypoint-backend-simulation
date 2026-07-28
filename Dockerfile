# Laundry Point POS — single image: Express API serving the built Vue frontend.
# Build context = this backend/ folder. The frontend must already be built into
# ./public (run `make web` before building — see Makefile / DEPLOY.md).
# syntax=docker/dockerfile:1

# ─────────────────────────── 1. Build backend ────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not ci): lockfile is generated on Windows and omits some
# Linux-only optional binaries that `npm ci` would reject.
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build

# ─────────────────────── 2. Production dependencies ──────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate

# ───────────────────────────── 3. Runtime ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIR=/app/public

# Prisma needs OpenSSL at runtime on Alpine; tini for clean signal handling.
RUN apk add --no-cache openssl tini

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./package.json
# Prebuilt Vue frontend (produced by `make web` and committed to the repo).
COPY public ./public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
