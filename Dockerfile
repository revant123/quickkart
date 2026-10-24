# One container for hosting (Render): the API also serves the built website.
#   docker build -t quickkart .   ->   docker run -p 10000:10000 -e DATABASE_URL=... quickkart
# Local development still uses docker-compose.yml (nginx + API + PostgreSQL + Redis + Mailpit).

# ---- 1. Build the React app into static files -------------------------------
FROM node:24-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. Compile the API (TypeScript -> JavaScript) --------------------------
FROM node:24-slim AS api
WORKDIR /api
COPY api/package*.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

# ---- 3. Run: compiled API + production dependencies + website + migrations ---
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=10000 \
    STATIC_DIR=/app/public \
    SEED_FILE=/app/seed/seed.sql
COPY api/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api /api/dist ./dist
COPY api/migrations ./migrations
COPY db/seed/seed.sql ./seed/seed.sql
COPY --from=web /web/dist ./public

USER node
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
