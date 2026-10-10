# syntax=docker/dockerfile:1

# Build the web client and the server bundle.
FROM node:25-slim AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

# Production dependencies of the server only.
FROM node:25-slim AS deps
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund

FROM node:25-slim
LABEL org.opencontainers.image.source="https://github.com/danieltyukov/devsbooth" \
      org.opencontainers.image.description="Self-hosted audio rooms for developers" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/dist/index.js"]
