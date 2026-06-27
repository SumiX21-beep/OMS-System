# OMS-omni — Omnichannel Inventory & Distributed Order Management

The upstream "source of truth" OMS/DOM. Owns multi-location inventory, canonical
orders, and the distributed sourcing brain that decides which node fulfils each
order. A downstream drift-guard (e.g. StockShield) reads from this and corrects
sales channels.

Stack: **NestJS + Prisma/Postgres + Redis/BullMQ**, split into three processes
(API / Worker / Scheduler).

## Repository layout

| Path | What |
|------|------|
| [`backend/`](backend/) | NestJS API, worker & scheduler (Prisma, Redis/BullMQ, Shopify, AI, SSE) |
| [`frontend/`](frontend/) | React + Vite + Tailwind operations console (dark UI) |
| [`docker-compose.yml`](docker-compose.yml) | Full stack: Postgres + Redis + backend + frontend |

## What's built (Phases 0–3)

| Phase | Capability |
|-------|-----------|
| **0 — Foundations** | Multi-tenant scaffolding, Prisma canonical model, Redis, BullMQ, idempotency, 3-process split |
| **1 — Inventory & ATP** | Event-sourced ledger → derived snapshot, concurrency-safe writes (row lock + version), Available-to-Promise engine with Redis cache, real-time availability API |
| **2 — Order capture** | Canonical omnichannel ingestion, explicit auditable state machine, idempotency keys, soft reservations with TTL + automatic expiry |
| **3 — Distributed orchestration** | Configurable rules-based sourcing engine (NEAREST / PRIORITY / FEWEST_SPLITS / BALANCED), hard allocation, **split-shipment** across nodes, capacity & backorder handling |
| **4 — Fulfilment & Returns** | Shipment pick → ship → deliver with real inventory ship-out, carrier/tracking stub, order-status rollup across split shipments, RMA returns that restock to ATP |
| **5 — Channel sync** | Transactional outbox on every ATP change, async drain to channel connectors, and the **source-of-truth feeds StockShield reads** (full snapshot + seq-cursored delta) |
| **6 — Hardening** | `/health` (DB+Redis), Prometheus `/metrics`, correlation-id request logging, and a ledger-vs-snapshot **reconciliation** job (report + repair) |
| **Integrations** | **Live Shopify push** (`inventorySetQuantities` via Admin GraphQL, SKU→InventoryItem mapping cache, dry-run without token), **OAuth** (authorization-code grant with query-HMAC + state nonce, token storage), and **signed inbound webhooks** (raw-body HMAC verify, Shopify `orders/create`+`orders/cancelled` normalization, idempotent on webhook-id, plus a generic signed marketplace webhook) |

### Hardening & extensions (latest)

- **Conflict-retry / re-plan** — reservation and sourcing transactions retry on
  transient contention (`retryOnConflict`), re-planning against fresh availability
  so flash-sale orders re-route instead of being spuriously rejected.
- **Order validation pipeline** — pluggable payment/fraud/tax/promo hooks run on
  `validate`; a declined/fraud order is auto-cancelled and blocked.
- **Inbound ETA precision** — `Inbound` records carry an `expectedAt`; ATP counts
  only stock arriving within `ATP_INBOUND_HORIZON_DAYS` (verified: 60-day inbound
  ignored, 2-day inbound raises ATP).
- **WMS/3PL handoff** — `dispatch` hands a picked shipment to a WMS adapter
  (records provider + job id; stub returns a synthetic job).
- **BOPIS / curbside** — `pick → ready → pickup` flow (`READY_FOR_PICKUP` →
  `PICKED_UP`), depleting stock on collection and completing the order.
- **Reporting API** — `/reports/orders|inventory|fulfillment|sourcing` aggregates
  for dashboards (status pipeline, low-stock, SLA, split-shipment rate).
- **AuthN/AuthZ** — two credential types feeding one RBAC
  (`ADMIN`/`OPERATOR`/`READ_ONLY`): **API keys** (`Authorization: Bearer` /
  `x-api-key`, sha256-stored) for machines, and **end-user JWT login**
  (`POST /auth/login` with email/password → bcrypt verify → HS256 token; users in
  the `User` table). The global guard accepts either on the same `Bearer` header.
  Dev fallback (`AUTH_REQUIRED=false`) trusts `x-tenant-id` as ADMIN.
- **Pluggable providers** — payment gateway (`PaymentProvider`: mock | **live
  Stripe**) drives the money lifecycle: authorize on validate → capture when the
  order ships → refund on return / void on cancel. The Stripe adapter creates real
  manual-capture PaymentIntents (`STRIPE_SECRET_KEY`), persisting the intent id on
  the order (`paymentReference`) for later capture/refund; without a key it dry-runs.
  WMS/3PL connector (`WmsProvider`: mock | ShipBob drop-in) drives shipment dispatch.
  All selected by env, all dry-run safely without vendor credentials.
- **Real-time across processes** — domain events fan out over a Redis pub/sub
  bridge, so a write in the worker (e.g. reservation TTL expiry) reaches SSE
  clients connected to the API.
- **Timestamptz** — all DateTime columns are now `@db.Timestamptz(3)`.
- **Tests** — `npm test` runs 45 Jest unit tests (HMAC, state machine, retry,
  validation, payments, geo) across 9 suites.

Not yet built: live **ShipBob** WMS SDK calls (the mock + dry-run adapter ships
today; Stripe payments are now live), and a hosted IdP option (the self-hosted JWT
path ships today).

### Shopify integration

Outbound push uses the GraphQL `inventorySetQuantities` mutation (validated against
the 2026-04 Admin schema) to set absolute available at a mapped Shopify location;
the SKU→`InventoryItem` mapping is resolved via `productVariants(query:"sku:…")`
and cached in `ChannelSkuMapping`. Without a configured token the connector logs a
dry-run, so dev works offline.

Inbound: `GET /oauth/shopify/install?shop=&tenant=` → consent → `GET /oauth/shopify/callback`
verifies the query HMAC + state nonce, exchanges the code for an offline token, and
stores it on the tenant's SHOPIFY channel. Webhooks hit `POST /webhooks/shopify`;
the **raw** body HMAC is verified with the app secret (`NestFactory({rawBody:true})`),
deliveries dedupe on `X-Shopify-Webhook-Id`, and `orders/create` is normalized to a
canonical order. Config the global app via `SHOPIFY_API_KEY/SECRET/SCOPES/API_VERSION`
and `APP_BASE_URL`.

## Architecture

```
                ┌─────────── API (HTTP) ───────────┐
   storefront → │ inventory · orders · sourcing     │
                └──────┬──────────────┬─────────────┘
                       │              │
        ┌──────────────▼───┐   ┌──────▼────────────┐
        │ Postgres (Prisma)│   │ Redis             │
        │  ledger+snapshot │   │  ATP cache + Bull │
        └──────────────────┘   └──────┬────────────┘
                       ▲               │ jobs
            sweep jobs │        ┌──────▼──────┐   ┌────────────┐
                       └────────│  Scheduler  │   │   Worker   │
                                │ (repeatable)│   │ (TTL expiry)│
                                └─────────────┘   └────────────┘
```

### Inventory is event-sourced

`InventoryLedger` is an append-only audit trail of signed bucket deltas.
`InventorySnapshot` is the derived per-(sku, location) balance used for fast ATP.
Every mutation:

1. locks the snapshot row (`SELECT … FOR UPDATE`),
2. validates resulting balances (no negative bucket; no oversell),
3. updates the snapshot (bumps `version`),
4. appends a ledger event,
5. invalidates the ATP cache.

The row lock serialises concurrent movements on a hot SKU — **two orders can
never allocate the same last unit**.

```
available          = onHand − reserved − allocated − safetyStock   (clamped ≥ 0)
availableToPromise = available + inbound (in-transit within horizon)
```

### Order lifecycle (state machine)

```
CREATED → VALIDATED → ALLOCATED → RELEASED → PICKED → SHIPPED → DELIVERED
   └──────────┴───────────┴──────────┴─────────┴── CANCELLED      DELIVERED → RETURNED
```
Transitions are declared in `order-state-machine.ts`; every transition writes an
immutable `OrderEvent`.

### Sourcing flow

`POST /orders/:id/source` (order must be `VALIDATED`), all in one transaction:
release the order's own soft holds → plan each line against fresh availability
under the chosen strategy → hard-allocate → group allocations into one shipment
per node (split-shipment) → mark `ALLOCATED`.

## Running locally

### Everything in Docker (one command)

```bash
# from the repo root: Postgres + Redis + api/worker/scheduler + frontend
docker compose up --build
# frontend → http://localhost:5173 · API → http://localhost:3000
```

### From source

```bash
cd backend                      # all backend code lives here (frontend is in ../frontend)

# infra (or use your own Postgres/Redis)
docker compose up -d

cp .env.example .env            # adjust DATABASE_URL / REDIS_* as needed
npm install
npx prisma migrate dev          # create schema
npm run db:seed                 # demo tenant "demo", 2 SKUs, 3 nodes, stock

npm run build
npm run start:api               # :3000
npm run start:worker            # reservation TTL expiry
npm run start:scheduler         # repeatable sweep
```

Every request is tenant-scoped via the `x-tenant-id` header (id or slug).

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/inventory/receipts` | Receive on-hand |
| `POST` | `/inventory/adjustments` | Signed correction |
| `POST` | `/inventory/inbound` `/inbound/arrive` | In-transit create / arrive |
| `POST` | `/inventory/safety-stock` | Set safety buffer |
| `GET`  | `/inventory/availability?skuId=&locationId=&breakdown=` | ATP (rollup / per-node / breakdown) |
| `POST` | `/orders` | Capture order (`Idempotency-Key` header supported) |
| `GET`  | `/orders/:id` | Order + lines + reservations + allocations + shipments + events |
| `POST` | `/orders/:id/validate` | → VALIDATED |
| `POST` | `/orders/:id/reserve` | Soft-reserve all lines |
| `POST` | `/orders/:id/source` | Run sourcing → ALLOCATED (split shipments) |
| `POST` | `/orders/:id/release` | → RELEASED |
| `POST` | `/orders/:id/cancel` | Release holds/allocations → CANCELLED |
| `POST` | `/shipments/:id/pick` `/ship` `/deliver` | Fulfilment lifecycle (ship-out depletes ATP) |
| `POST` | `/returns` · `/returns/:id/receive` | Create RMA · receive + restock |
| `GET`  | `/channels` · `POST` `/channels` | List / register sales channels |
| `GET`  | `/sync/inventory` | Canonical full ATP feed (StockShield source of truth) |
| `GET`  | `/sync/inventory/changes?since=&limit=` | Seq-cursored delta feed |
| `GET`  | `/admin/reconciliation` · `POST` `/admin/reconciliation/repair` | Drift report / repair |
| `GET`  | `/health` · `/metrics` | Liveness (DB+Redis) · Prometheus metrics |

Example:
```bash
curl -X POST localhost:3000/orders \
  -H 'content-type: application/json' -H 'x-tenant-id: demo' \
  -H 'idempotency-key: order-1' \
  -d '{"channel":"WEB","externalRef":"SHOP-1","reserveOnCreate":true,
       "shipToLatitude":42.36,"shipToLongitude":-71.06,
       "lines":[{"skuId":"<MUG_ID>","quantity":35}]}'
```

## Verified behaviour (smoke tests)

- ATP rollup, per-location, and breakdown reads (Redis-cached).
- Idempotent order capture: replay returns the original; a different body for the
  same key → **409**.
- Reserve → validate → source → **split shipment** (SHIP_FROM_DC + SHIP_FROM_STORE).
- Reservation correctly hardens into allocation (reserved→0, allocated→qty).
- **No oversell under 20-way concurrency** (demand 200 vs 158 on hand): exactly
  the available units were committed; `reserved ≤ onHand`, no negative ATP.
- Cancel releases allocation back to ATP; backorder (no-backorder) → 400; illegal
  transition (source before validate) → 400; full audit trail recorded.
- TTL expiry: backdated reservation reclaimed by the scheduler-driven worker sweep.

## Known trade-offs / next steps

- **Optimistic planning.** Sourcing/reservation plans against a snapshot read,
  then re-validates under the row lock at commit. Correctness (no oversell) is
  guaranteed, but under extreme contention some orders are *rejected* rather than
  re-planned onto another node, leaving stock unsold. Add a **conflict-retry /
  re-plan loop** for higher fill-rate under flash-sale load.
- Inbound lead-time filtering is coarse (snapshot-level `inTransit`); per-inbound
  ETA records would make the ATP horizon exact.
- Sourcing cost-to-serve and richer capacity models (per-day counts) are stubbed.
- DateTime columns are tz-naive `timestamp` (Prisma reads/writes UTC consistently).
  Since this OMS is built for raw-SQL reconciliation jobs by other writers, switch
  expiry/audit timestamps to `@db.Timestamptz(3)` to avoid mixed-basis comparisons.
- BOPIS/curbside fulfilment types exist in the model but aren't yet wired to a
  pickup flow.
```
