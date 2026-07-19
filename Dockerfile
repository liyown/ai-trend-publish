FROM node:24-slim

WORKDIR /app

ENV TRENDPUBLISH_RUNTIME=docker
ENV TRENDPUBLISH_CONFIG=/app/config/trendpublish.config.ts
ENV PATH=/app/node_modules/.bin:$PATH

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/article/package.json ./packages/article/package.json
COPY packages/connectors/package.json ./packages/connectors/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/ops/package.json ./packages/ops/package.json
COPY packages/publishing/package.json ./packages/publishing/package.json
COPY packages/runtime/package.json ./packages/runtime/package.json

RUN npm install -g vite-plus@0.1.24 \
  && vp install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY scripts ./scripts
COPY migrations ./migrations
COPY trendpublish.config.example.ts ./trendpublish.config.example.ts
COPY trendpublish.config.docker.example.ts ./trendpublish.config.docker.example.ts
COPY trendpublish.config.cloudflare.ts ./trendpublish.config.cloudflare.ts
COPY wrangler.jsonc ./wrangler.jsonc
COPY tsconfig.json vite.config.ts vitest.config.ts ./

RUN vp run @trendpublish/dashboard#build
RUN mkdir -p /app/config /app/data \
  && chown -R node:node /app

USER node

EXPOSE 8000

CMD ["vp", "run", "@trendpublish/server#start"]
