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
# Opt-in: offer the scale simulator in this production build (its weights are recorded as SIMULATED).
ARG NEXT_PUBLIC_SCALE_SIMULATOR=
ENV NEXT_PUBLIC_SCALE_SIMULATOR=$NEXT_PUBLIC_SCALE_SIMULATOR \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build


FROM base AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# standalone output contains server.js plus only the node_modules the app uses
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "server.js"]