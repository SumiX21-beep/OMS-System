# OMS-omni Console (frontend)

Operations console (admin SPA) for the OMS/DOM backend.
Stack: **React + Vite + TypeScript + Tailwind + TanStack Query + React Router + Recharts**.

## Run

```bash
# backend must be running on :3000 (npm run start:api in the repo root)
cp .env .env.local   # optional; defaults to VITE_API_URL=http://localhost:3000
npm install
npm run dev          # http://localhost:5173
```

Sign in with tenant `demo`. In dev (API `AUTH_REQUIRED=false`) the tenant header is
trusted and you pick an access level; in prod paste an API key (e.g.
`oms_demo_operator_key`) and the backend enforces the real role.

## What's implemented (first slice)

- **Foundation** — typed API client (auth header + tenant + error/401 handling),
  auth context with localStorage, RBAC (`RoleGate`/`useCan`), app shell
  (sidebar + topbar + tenant/role), toast + modal + table UI primitives.
- **Dashboard** — KPI cards + orders-by-status chart + low-stock table from
  `/reports/*` (auto-refresh 15s).
- **Inventory** — stock-by-SKU/location table (search), expected-inbound table,
  and action dialogs: receive / adjust / inbound (with ETA) / safety stock.
- **Orders** — list (status/search filters, paginated), create dialog (multi-line,
  reserve-on-create), detail page with **lifecycle action buttons** (validate →
  reserve → source → release → cancel), status **timeline**, lines, and a
  **shipments** table with per-shipment fulfilment actions (pick / dispatch /
  ship / deliver, and BOPIS ready / pickup). All writes gated by role.

## Structure

```
src/
  lib/        api client, auth store, types, formatters, query client
  auth/       AuthContext, LoginScreen, RoleGate
  components/ ui primitives (button/card/input/modal/table/toast), layout, common
  pages/      DashboardPage, inventory/*, orders/*
```

## Modules (complete console)

- **Dashboard** — KPIs + orders-by-status chart + low-stock.
- **Inventory** — stock table + inbound + receive/adjust/inbound/safety dialogs.
- **Orders** — list, create, detail (lifecycle actions, timeline, shipments).
- **Fulfilment** — shipments board (status filter, auto-refresh) + pick/dispatch/
  ship/deliver/ready/pickup actions.
- **Catalog** — SKUs + Locations lists + create dialogs.
- **Sourcing rules** — list + create (strategy/channel/region/priority).
- **Channels** — list, add channel, and **Connect Shopify** (OAuth install link).
- **Admin** — API keys (mint with one-time secret reveal) + **reconciliation**
  (ledger-vs-snapshot drift report + repair). ADMIN-gated.

Routes/nav cover all of the above; writes are RBAC-gated (READ_ONLY view-only,
ADMIN for channels/admin).
