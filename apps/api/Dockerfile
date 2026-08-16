FROM node:20-alpine AS base
WORKDIR /app

# Semua dependency (termasuk prisma CLI untuk migrate deploy saat startup)
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# Build TypeScript
FROM base AS build
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx tsc -p tsconfig.json

# Runtime
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=deps /app/prisma ./prisma
RUN mkdir -p uploads
EXPOSE 4000
# Migration otomatis saat container pertama kali jalan, lalu jalankan server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
