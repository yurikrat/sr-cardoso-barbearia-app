# Stage 1: Base (Dependencies)
FROM node:20-bookworm-slim AS base
WORKDIR /app
# Copy package definitions first for better caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
# Install dependencies
RUN npm ci --no-audit --no-fund

# Stage 2: Build Shared
FROM base AS build-shared
COPY packages/shared ./packages/shared
RUN npm run build --workspace=packages/shared

# Stage 3: Build Web (Parallel)
FROM build-shared AS build-web
COPY apps/web ./apps/web
RUN npm run build --workspace=apps/web

# Stage 4: Build Server (Parallel)
FROM build-shared AS build-server
COPY apps/server ./apps/server
RUN npm run build --workspace=apps/server

# Stage 5: Final Image
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/apps/web/dist

# Copy root node_modules
COPY --from=base /app/node_modules ./node_modules

# Copy workspace structures (to preserve node_modules nesting)
COPY --from=base /app/apps/server ./apps/server
COPY --from=build-shared /app/packages/shared ./packages/shared

# Copy built artifacts
COPY --from=build-server /app/apps/server/dist ./apps/server/dist
COPY --from=build-web /app/apps/web/dist ./apps/web/dist

# Set working directory to server app to match local development structure
WORKDIR /app/apps/server

EXPOSE 8080
CMD ["node", "dist/index.js"]


