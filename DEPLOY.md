# Deployment — Laundry Point (single image)

Everything lives in **this backend repo**. One image runs the Express API **and**
the built Vue frontend on the same port (frontend calls a relative `/api`, so no
CORS or extra host).

## The flow

```
 make web            git tag v1.0.0 + push       GitHub Action
 (build FE  ───────► (backend repo) ───────────► builds & pushes
  into ./public)                                  ghcr.io/OWNER/laundrypoint
```

1. **Build the frontend into the backend** — the Vue source lives in `../cashier`:
   ```bash
   make web            # builds cashier with VITE_API_URL=/api → copies to ./public
   git add public && git commit -m "build web"
   ```
2. **Tag & push** the backend repo — this is the *only* trigger for CI:
   ```bash
   make release V=v1.0.0     # = git tag v1.0.0 && git push origin v1.0.0
   ```
   `.github/workflows/release.yml` runs on tag push only (no branch/PR builds),
   builds the Docker image (using the committed `./public`), and pushes it to
   `ghcr.io/<owner>/<repo>` tagged `1.0.0`, `1.0`, `v1.0.0`, `latest`.
   It uses the built-in `GITHUB_TOKEN` — no secrets to configure. If `./public`
   is missing, the job fails early with a clear message.

## Run it on a server

```bash
cp .env.example .env      # set IMAGE=ghcr.io/OWNER/laundrypoint, JWT_SECRET, POSTGRES_PASSWORD
make first-deploy         # up (db+app) + db push + seed + health
```

Open **http://SERVER:3000** — PIN **1234**; owner `owner@laundrypoint.id` / `owner123`.

`make help` lists everything: `web`, `image`, `push`, `release`, `up`, `down`,
`deploy`, `migrate`, `seed`, `logs`, `reset-db`.

## Local image build (no CI)

```bash
make image-web            # make web + docker build
docker compose up -d      # or: make up
```

## Notes

- Schema is applied with `prisma db push` (matches the project workflow); the
  container does it on boot when `RUN_MIGRATIONS=true` (compose default).
- `RUN_SEED` defaults to `false` — seed once with `make seed`.
- To use an external database, override `DATABASE_URL` in `.env` and drop the
  `db` service.
- `./public` is a build artifact that is intentionally committed so CI (which
  only has this backend repo) can package it. Re-run `make web` whenever the
  frontend changes.
