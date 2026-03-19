# =====================
# Builder
# =====================
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./

RUN npm install
RUN npm install sharp -g
RUN npx prisma generate

COPY . .
RUN npm run build
RUN npx tsc --module commonjs --target es2020 --esModuleInterop --skipLibCheck --rootDir . --outDir dist prisma/seed.ts

# =====================
# Runner
# =====================
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/prisma.config.ts ./
RUN npm install --omit=dev --ignore-scripts
RUN npm install sharp -g

COPY --from=builder /usr/src/app/dist ./dist
RUN npx prisma generate

EXPOSE 3333
CMD npx prisma migrate resolve --applied "20260214114921_init" 2>/dev/null || true && npx prisma migrate deploy && node dist/prisma/seed.js && node dist/src/main