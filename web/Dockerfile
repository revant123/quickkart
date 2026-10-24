# ---- Stage 1: build the React app into static files (dist/) ---------------
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: nginx serves the files and forwards /api to the API ---------
# The final image has no Node.js at all: just nginx and ~350 KB of files.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
