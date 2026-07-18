# Laundry Point — Backend

REST API for the Laundry Point POS. Mirrors the cashier frontend domain
(`../cashier`): outlet → employee (PIN auth) → order (cart of services) → payment.

**Stack:** Node + Express + TypeScript · Prisma ORM · PostgreSQL · Zod · JWT · bcryptjs

## Setup

```bash
cd backend
npm install

# 1. Point .env at your DB (already set to the provided URL)
#    DATABASE_URL="postgresql://postgres:admin@localhost:5431/laundrypoint?schema=public"

# 2. Generate the Prisma client
npm run prisma:generate

# 3. Create the schema in the database
npm run prisma:migrate      # dev migration (creates prisma/migrations)
#   or, without migration history:
npm run db:push

# 4. Seed catalog + employees + outlet (mirrors the cashier UI)
npm run db:seed

# 5. Run
npm run dev                 # http://localhost:3000  (watch mode)
```

Requires the PostgreSQL server to be running and reachable at the `DATABASE_URL`
host/port (`localhost:5431`) with a database named `laundrypoint`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server with hot reload (tsx watch) |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run db:push` | Push schema without a migration |
| `npm run db:seed` | Seed reference data |
| `npm run prisma:studio` | Browse the DB in Prisma Studio |
| `npm run typecheck` | Type-check only |

## Seeded credentials

- **Owner login** (email/password): `owner@laundrypoint.id` / `owner123`
- **Station PIN** (all employees): `1234`

## API

Base URL: `http://localhost:3000/api`. Responses are `{ data }` (or `{ error, details }`).
Mutating routes require `Authorization: Bearer <token>`.

### Auth
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/auth/login` | `{ email, password }` | Owner/admin login → `{ token, employee }` |
| POST | `/auth/pin` | `{ employeeId, pin }` | Station login → `{ token, employee }` |
| GET | `/auth/me` | — | Current session (auth) |
| POST | `/auth/logout` | — | Set employee offline (auth) |

### Employees — `/employees`
`GET /` (`?outletId&role&status&q`) · `GET /:id` · `POST /` · `PATCH /:id` ·
`PATCH /:id/status` · `DELETE /:id`

### Services (catalog) — `/services`
`GET /` (`?category=kiloan|non-kiloan|3rd-party&q&active`) · `GET /:id` ·
`POST /` · `PATCH /:id` · `DELETE /:id`

### Customers — `/customers`
`GET /` (`?q` — name or phone) · `GET /:id` (with order history) · `POST /` · `PATCH /:id`

### Orders — `/orders`
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | `?status&paymentStatus&customerId&q` — kanban board |
| GET | `/:id` | With items, payments, customer, cashier |
| POST | `/` | Create from cart (validates & prices server-side) |
| PATCH | `/:id/status` | Move workstation stage |
| POST | `/:id/payment` | Record payment, returns change |

### Outlets — `/outlets`
`GET /` · `GET /:id` · `POST /` · `PATCH /:id`

## Create-order payload

Matches the cashier's "Lanjut ke Pembayaran" flow:

```json
{
  "customer": { "name": "Ibu Wulan Sari", "phone": "0812-3456-7890", "memberLabel": "Member 5%", "discountPct": 5 },
  "items": [
    { "serviceId": "…", "name": "Reguler", "price": 7000, "unit": "kg", "category": "kiloan", "qty": 3.5 }
  ],
  "notes": "Pisahkan yang putih",
  "delivery": false,
  "estimasi": "Sen, 27 Mei"
}
```

`subtotal`, `discount`, and `total` are computed on the server; when `serviceId`
is present the item price is taken from the catalog (client price is ignored).

## Data model

`Outlet 1─* Employee` · `Outlet 1─* Order` · `Customer 1─* Order` ·
`Employee(cashier) 1─* Order` · `Order 1─* OrderItem *─1 Service` · `Order 1─* Payment`.

`OrderItem` snapshots name/price/unit/category so historical orders stay correct
if a `Service` later changes. See `prisma/schema.prisma`.

The API translates Prisma enums to the frontend's string shapes
(`KILOAN`→`kiloan`, `KG`→`kg`, `CUCI_KERING`→`Cuci / Kering`, …) in
`src/utils/serializers.ts`, so responses drop straight into the cashier UI.
