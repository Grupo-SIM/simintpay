# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY checkout/package.json checkout/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --ignore-scripts --filter frontend

FROM dependencies AS build
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_CHECKOUT_BASE_URL
ARG NEXT_PUBLIC_CLIENT_MIN_AMOUNT=14.99
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_CHECKOUT_BASE_URL=$NEXT_PUBLIC_CHECKOUT_BASE_URL \
    NEXT_PUBLIC_CLIENT_MIN_AMOUNT=$NEXT_PUBLIC_CLIENT_MIN_AMOUNT \
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=$NEXT_PUBLIC_RECAPTCHA_SITE_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY frontend ./frontend
RUN bun run --cwd frontend build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "frontend/server.js"]
