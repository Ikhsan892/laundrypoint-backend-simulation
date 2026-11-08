#!/bin/sh
# Entry point for the Laundry Point image.
# Optional one-shot DB tasks (controlled by env), then exec the given command.
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  # Tabel lama yang sengaja dihapus di v0.1.6 (diganti MaintenanceRecord & StationCheck).
  # Di-drop eksplisit supaya db push tidak berhenti di peringatan data loss,
  # tanpa --accept-data-loss yang bisa menghapus data lain diam-diam.
  echo "→ Dropping obsolete tables (if any)..."
  echo 'DROP TABLE IF EXISTS "IronCheck", "MaintenanceLog", "MaintenanceSchedule" CASCADE;'     | npx prisma db execute --stdin --schema prisma/schema.prisma

  echo "→ Syncing database schema (prisma db push)..."
  npx prisma db push --skip-generate
fi

if [ "${RUN_SEED}" = "true" ]; then
  echo "→ Seeding reference data (prisma db seed)..."
  npx prisma db seed || echo "  (seed skipped/failed — continuing)"
fi

exec "$@"
