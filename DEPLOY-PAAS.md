# Deploying OMS-omni for free — Vercel + Render + Neon + Upstash

A 100% free-tier split deploy, no server to manage:

| Piece | Host | Free tier |
|-------|------|-----------|
| Frontend (React SPA) | **Vercel** | yes |
| Backend (API + worker + scheduler, one process) | **Render** web service | yes (sleeps when idle) |
| Postgres | **Neon** | yes (persistent) |
| Redis (BullMQ) | **Upstash** | yes |

```
  Browser ──► Vercel (SPA)  ──HTTPS──►  Render (NestJS all-in-one)
                                           │            │
                                     Neon Postgres   Upstash Redis
```

The backend runs as a single process via `node dist/main.all.js` (see
[`src/main.all.ts`](backend/src/main.all.ts)) — the API, BullMQ worker and
scheduler share one Prisma/Redis connection. That's what lets it fit a free
single-service plan.

---

## 1. Postgres — Neon

1. https://neon.tech → new project (pick a region near your Render region).
2. Copy the **connection string**; ensure it ends with `?sslmode=require`.
   Example: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
3. Keep it for `DATABASE_URL`.

## 2. Redis — Upstash

1. https://upstash.com → **Create Database** → Redis, region near Render.
2. On the database page copy the **`rediss://` connection URL** (it includes the
   password and enables TLS). Example: `rediss://default:xxxxx@us1-xxx.upstash.io:6379`
3. Keep it for `REDIS_URL`.

## 3. Backend — Render

**Option A — Blueprint (recommended):** the repo ships [`render.yaml`](render.yaml).

1. https://render.com → **New → Blueprint** → connect this GitHub repo.
2. Render reads `render.yaml` and creates the `oms-omni-api` web service.
3. When prompted, paste:
   - `DATABASE_URL` = your Neon string
   - `REDIS_URL` = your Upstash string
   (`JWT_SECRET` and `SECRET_ENCRYPTION_KEY` are generated automatically.)
4. **Create** and wait for the build. First boot runs `prisma migrate deploy`,
   seeds the demo tenant, then starts.

**Option B — manual:** New → Web Service → this repo, **Root Directory** `backend`,
Build `npm ci && npx prisma generate && npm run build`, Start
`npx prisma migrate deploy && (npx ts-node prisma/seed.ts || true) && node dist/main.all.js`,
Health check path `/health`, and add the env vars from `render.yaml`.

You'll get a URL like `https://oms-omni-api.onrender.com`. Verify:
`curl https://oms-omni-api.onrender.com/health`.

> **Free-tier note:** the service **sleeps after ~15 min idle**; the next request
> cold-starts it (~30–60 s). Fine for a demo. Neon and Upstash also wake on demand.

## 4. Frontend — Vercel

1. https://vercel.com → **Add New → Project** → import this repo.
2. **Root Directory:** `frontend` (Vercel auto-detects Vite + [`vercel.json`](frontend/vercel.json)).
3. **Environment Variables:** add
   `VITE_API_URL = https://oms-omni-api.onrender.com`  *(your Render URL — no trailing slash, no `/api`)*.
4. **Deploy.** You'll get `https://<your-app>.vercel.app`.

> `VITE_API_URL` is baked in at build time. If the Render URL changes, update the
> var and redeploy the Vercel project.

## 5. Lock down CORS (optional)

On Render → the service → Environment → set `CORS_ORIGIN` to your Vercel URL
(`https://<your-app>.vercel.app`) and save (it redeploys). Leaving `*` also works
for a public demo.

## 6. Log in

Open your Vercel URL:

| Field | Value |
|-------|-------|
| Tenant | `demo` |
| Email | `admin@demo.test` |
| Password | `demo1234` |

---

## Notes & tuning

- **Change the demo credentials** before treating this as real: edit the seed or
  remove `npx ts-node prisma/seed.ts` from the Render start command and create
  your own admin.
- **Upstash command budget:** the scheduler polls Redis frequently. If you bump
  into the free command limit, raise the intervals on Render via env:
  `SYNC_DRAIN_INTERVAL_MS=60000`, `RESERVATION_SWEEP_INTERVAL_MS=120000`,
  `RECONCILE_INTERVAL_MS=900000`.
- **Live Stripe:** set `PAYMENT_PROVIDER=stripe` and `STRIPE_SECRET_KEY` on Render.
- **Scaling:** to split the worker/scheduler back into their own processes (paid
  Render background workers, or the VM path), use the separate entrypoints — see
  [DEPLOY.md](DEPLOY.md) / [docker-compose.yml](docker-compose.yml).
