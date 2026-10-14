# ---- build stage: client + server ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npx tsc -p tsconfig.server.json

# ---- runtime ----
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data CLIENT_DIR=/app/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
# The assistant's codebase knowledge: a source snapshot (no build output) plus git for its patch
# workspace and Claude Code's CLI for the owner's subscription backend.
ARG SOURCE_VERSION=dev
ENV SOURCE_DIR=/app/source
RUN apk add --no-cache git ripgrep && npm i -g @anthropic-ai/claude-code && npm cache clean --force
COPY --from=build /app/src ./source/src
COPY --from=build /app/server/src ./source/server/src
COPY --from=build /app/deploy ./source/deploy
COPY --from=build /app/.github ./source/.github
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig*.json /app/vite.config.ts /app/index.html /app/Dockerfile /app/.dockerignore /app/docker-compose*.yml /app/README.md ./source/
RUN echo "$SOURCE_VERSION" > ./source/.source-version && mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/dist/index.js"]
