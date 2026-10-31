# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY checkout/package.json checkout/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --ignore-scripts --filter backend

FROM dependencies AS build
COPY backend ./backend
RUN bun run --cwd backend generate
RUN bun run --cwd backend build

# Explicit maintenance image. Never run migrations or seeds during API startup.
FROM node:22-bookworm-slim AS maintenance
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend
USER node
ENTRYPOINT ["node", "../node_modules/prisma/build/index.js"]
CMD ["--help"]

# Published one-shot image: compose runs it before the API starts. Node runs the
# Prisma CLI (its shebang); Bun runs the package script like the other projects.
FROM node:22-bookworm-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend
USER node
CMD ["bun", "run", "migrate:deploy"]

FROM oven/bun:1.4.4 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY checkout/package.json checkout/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts --filter backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3333
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/api/docs-json').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/main.js"]
