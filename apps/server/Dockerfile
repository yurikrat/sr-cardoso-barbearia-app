# Stage 1: Base (Dependencies)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Enable BuildKit cache for npm
ENV NPM_CONFIG_CACHE=/app/.npm

# Copy package definitions first for better caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/

# Install dependencies using cache mount
RUN --mount=type=cache,target=/app/.npm \
    npm ci --no-audit --no-fund

# Stage 2: Build Shared
FROM base AS build-shared
COPY packages/shared ./packages/shared
RUN npx tsc -b packages/shared/tsconfig.json

# Stage 3: Build Web (Parallel)
FROM build-shared AS build-web
COPY apps/web ./apps/web
# Use cache for build artifacts if possible (e.g. vite cache)
RUN --mount=type=cache,target=/app/apps/web/node_modules/.vite \
    npm run build --workspace=apps/web

# Stage 4: Build Server (Parallel)
FROM build-shared AS build-server
COPY apps/server ./apps/server
RUN npx tsc -b apps/server/tsconfig.json

# Stage 5: Final Image
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/apps/web/dist

# Copy root node_modules and prune devDependencies
COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/apps/server/package.json ./apps/server/

# Prune dev dependencies to keep image small
RUN npm prune --production --no-audit --no-fund

# Copy workspace structures
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY --from=build-server /app/apps/server/dist ./apps/server/dist
COPY --from=build-web /app/apps/web/dist ./apps/web/dist

# Set working directory to server app
WORKDIR /app/apps/server

EXPOSE 8080
CMD ["node", "dist/index.js"]


