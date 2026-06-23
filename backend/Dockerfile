# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# Prisma needs OpenSSL present to fetch the right query engine.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Carry the built artefacts: node_modules (with the generated Prisma client and
# the prisma CLI for `migrate deploy`), compiled JS, and the schema.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY prisma ./prisma

EXPOSE 3000
# Override with `node dist/main.worker.js` / `node dist/main.scheduler.js` for the
# worker and scheduler processes (see docker-compose.yml).
CMD ["node", "dist/main.js"]
