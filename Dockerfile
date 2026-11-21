# syntax=docker/dockerfile:1.7
# Next.js app image (standalone output). Requires `output: "standalone"` in next.config.ts.
# Debian slim (glibc) rather than Alpine: matches Prisma's and @node-rs/argon2's prebuilt binaries.

ARG NODE_VERSION=22.12.0

# ---- deps: install from the lockfile only (cached until package*.json changes) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Browser-side Sentry DSN is inlined at build time (it is public by design; server DSN is runtime env).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Prisma's generated client + query engine; file tracing normally includes it, this makes it explicit.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

USER node
EXPOSE 3000
# Liveness only: any HTTP answer means the server is up (/api/health returns 503 when a dependency is down,
# which should not get the app container restarted).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(()=>process.exit(0),()=>process.exit(1))"
CMD ["node", "server.js"]
