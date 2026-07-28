#!/bin/sh
# Entry point for the Laundry Point image.
# Optional one-shot DB tasks (controlled by env), then exec the given command.
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "→ Syncing database schema (prisma db push)..."
  npx prisma db push --skip-generate
fi

if [ "${RUN_SEED}" = "true" ]; then
  echo "→ Seeding reference data (prisma db seed)..."
  npx prisma db seed || echo "  (seed skipped/failed — continuing)"
fi

exec "$@"
