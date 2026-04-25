# Production Dockerfile for Scrabble server
FROM node:20-slim AS base

# Install OpenSSL — Prisma needs it at runtime on slim images
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# Generate Prisma client (postinstall already does this, but be safe)
RUN npx prisma generate

# Don't run as root in production
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]