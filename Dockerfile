FROM node:22-alpine AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# pnpm version comes from package.json's "packageManager" field (must match pnpm-lock.yaml)
RUN corepack enable


FROM base AS deps

COPY package.json pnpm-lock.yaml ./

# The store cache mount means a lockfile change only downloads the new packages
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile


FROM base AS builder

# NEXT_PUBLIC_* values are inlined into the client bundle and rewrites are
# baked into the routes manifest, so both must be known at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build


FROM base AS runner

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

# Run next directly so the container doesn't fetch pnpm through corepack at startup
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
