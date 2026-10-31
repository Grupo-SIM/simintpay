# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY checkout/package.json checkout/package.json
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY bun.lock turbo.jsonc bunfig.toml ./
COPY backend ./backend
COPY checkout ./checkout
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SIM_API_URL
ARG NEXT_PUBLIC_API_PAGATG_URL
ARG NEXT_PUBLIC_EBOOK_API_URL
ENV NEXT_PUBLIC_SIM_API_URL=${NEXT_PUBLIC_SIM_API_URL} \
    NEXT_PUBLIC_API_PAGATG_URL=${NEXT_PUBLIC_API_PAGATG_URL} \
    NEXT_PUBLIC_EBOOK_API_URL=${NEXT_PUBLIC_EBOOK_API_URL}
WORKDIR /app
RUN bun turbo -F checkout build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/checkout/.next/standalone ./
COPY --from=build --chown=node:node /app/checkout/.next/static ./checkout/.next/static
COPY --from=build --chown=node:node /app/checkout/public ./checkout/public
USER node
EXPOSE 3000
CMD ["node", "checkout/server.js"]
