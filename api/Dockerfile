# ---- Stage 1: build -------------------------------------------------------
# Has TypeScript and every dev dependency; only its output (dist/) is kept.
FROM node:24-slim AS build
WORKDIR /app

# Copy ONLY the dependency lists first. Docker caches each step (layer), so as
# long as package*.json don't change, `npm ci` is skipped on the next build
# even when you edit source files. Order matters for build speed.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: run ---------------------------------------------------------
# Small image: compiled JavaScript + production dependencies only.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# Don't run as root inside the container
USER node
EXPOSE 4000

# Docker asks this every few seconds; nginx only gets traffic routed once it passes
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
