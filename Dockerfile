FROM oven/bun:1 AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/dashboard/package.json ./packages/dashboard/
RUN bun install --frozen-lockfile

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --cwd packages/dashboard build

# Production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Copy standalone build
COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public

EXPOSE 3000
ENV PORT=3000

CMD ["node", "packages/dashboard/server.js"]
