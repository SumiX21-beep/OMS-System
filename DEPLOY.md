# Deploying OMS-omni — Oracle Cloud Free VM + Docker + Nginx

This deploys the full stack (Postgres · Redis · API · worker · scheduler ·
frontend) behind a single nginx reverse proxy, using [`docker-compose.prod.yml`](docker-compose.prod.yml).
Only ports **80/443** are exposed publicly; everything else stays on the internal
Docker network.

```
              Internet
                 │  80/443
         ┌───────▼────────┐
         │  nginx  proxy  │   /api/* → api:3000   /* → frontend:80
         └───┬────────┬───┘
        api:3000   frontend:80
             │
   postgres ─┴─ redis      (internal only, never published)
```

The free tier is enough: pick an **Ampere A1 (ARM)** shape — Always Free allows up
to 4 OCPU / 24 GB RAM. All images used are multi-arch, so ARM64 works unchanged.

---

## 1. Create the VM

1. Oracle Cloud Console → **Compute → Instances → Create instance**.
2. Image **Ubuntu 22.04**, shape **VM.Standard.A1.Flex** (e.g. 2 OCPU / 12 GB).
3. Add your **SSH public key**, create. Note the **public IP**.

## 2. Open the firewall (two layers — both required)

**a) VCN ingress rules** — Networking → your VCN → the subnet's **Security List**
→ add **Ingress** rules (Source `0.0.0.0/0`):

| Protocol | Dest. port | Purpose |
|----------|-----------|---------|
| TCP | 80  | HTTP |
| TCP | 443 | HTTPS (when you add TLS) |

**b) Host firewall** — Oracle Ubuntu images ship restrictive `iptables`. SSH in
and allow 80/443:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save      # persist across reboots
```

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker   # run docker without sudo
```

## 4. Get the code + configure

```bash
git clone https://github.com/SumiX21-beep/OMS-System.git
cd OMS-System

cp deploy/.env.prod.example .env
nano .env        # fill in PUBLIC_URL, POSTGRES_PASSWORD, JWT_SECRET, SECRET_ENCRYPTION_KEY
```

Generate the secrets quickly:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)"
```

Set `PUBLIC_URL` to `http://<VM_PUBLIC_IP>` for an IP-only demo (or your domain).

> **Note:** `PUBLIC_URL` is baked into the frontend at build time. If you change
> it later, rebuild the frontend: `docker compose -f docker-compose.prod.yml up -d --build frontend`.

## 5. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First run builds the images, applies migrations, and seeds a demo tenant. Watch
progress with `docker compose -f docker-compose.prod.yml logs -f`.

Open **`http://<VM_PUBLIC_IP>`** and log in:

| Field | Value |
|-------|-------|
| Tenant | `demo` |
| Email | `admin@demo.test` |
| Password | `demo1234` |

API health check: `curl http://<VM_PUBLIC_IP>/api/health`.

---

## 6. HTTPS (optional, recommended)

Easiest path with a real domain (point an A record at the VM IP):

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d oms.example.com   # briefly needs port 80 free
sudo mkdir -p deploy/nginx/certs
sudo cp /etc/letsencrypt/live/oms.example.com/{fullchain,privkey}.pem deploy/nginx/certs/
```

Then in [`deploy/nginx/reverse-proxy.conf`](deploy/nginx/reverse-proxy.conf) add a
`listen 443 ssl;` server block pointing at `/etc/nginx/certs/fullchain.pem` +
`privkey.pem`, uncomment the `443` port and the `certs` volume in
`docker-compose.prod.yml`, set `PUBLIC_URL=https://oms.example.com`, and
`docker compose -f docker-compose.prod.yml up -d --build`.

---

## Operations

```bash
# logs (all or one service)
docker compose -f docker-compose.prod.yml logs -f [api|worker|frontend|proxy]

# update to latest code
git pull && docker compose -f docker-compose.prod.yml up -d --build

# stop / start
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# backup the database
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres oms_omni > backup_$(date +%F).sql
```

## Hardening before real (non-demo) use

- **Remove the demo seed:** in `docker-compose.prod.yml` change the `migrate`
  command to `npx prisma migrate deploy` only, then create your own admin via the
  API/console. Otherwise `admin@demo.test / demo1234` exists publicly.
- Keep `AUTH_REQUIRED=true` (already set here).
- Use strong unique values for every `CHANGE_ME` in `.env`.
- Put real Stripe keys in `.env` and set `PAYMENT_PROVIDER=stripe` only when ready.
- Take regular `pg_dump` backups (the data lives in the `oms_pg` volume).
