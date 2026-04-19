FROM node:22-alpine AS base
RUN apk add --no-cache tzdata python3 make g++ libc6-compat

FROM base AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs app
COPY --from=builder --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/dist ./dist
COPY --from=builder --chown=app:nodejs /app/server ./server
COPY --from=builder --chown=app:nodejs /app/package.json ./package.json
RUN mkdir -p /app/server/data && chown -R app:nodejs /app/server/data
USER app
EXPOSE 3002
CMD ["node", "server/index.js"]
