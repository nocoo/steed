FROM oven/bun:1 AS base

# --- Install dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/worker/package.json packages/worker/
RUN bun install --frozen-lockfile --ignore-scripts

# --- Build ---
FROM base AS builder
WORKDIR /app

# Railway injects service env vars as Docker build args.
# Next.js needs these at build time for page data collection.
ARG WORKER_API_URL
ARG DASHBOARD_SERVICE_TOKEN
ARG NEXTAUTH_SECRET
ARG AUTH_GOOGLE_ID
ARG AUTH_GOOGLE_SECRET
ENV WORKER_API_URL=$WORKER_API_URL
ENV DASHBOARD_SERVICE_TOKEN=$DASHBOARD_SERVICE_TOKEN
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV AUTH_GOOGLE_ID=$AUTH_GOOGLE_ID
ENV AUTH_GOOGLE_SECRET=$AUTH_GOOGLE_SECRET

COPY --from=deps /app ./
COPY . .
RUN bun run --filter @steed/shared build 2>/dev/null || true
RUN bun run --filter @steed/dashboard build

# --- Production image ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/dashboard/server.js"]
