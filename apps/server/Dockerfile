FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY . .

# Instala deps do monorepo (workspaces) e faz build
RUN npm ci --no-audit --no-fund
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/web
RUN npm run build --workspace=apps/server

FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/web-dist

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web-dist
COPY --from=build /app/apps/server/package.json ./package.json

EXPOSE 8080
CMD ["node", "dist/index.js"]


