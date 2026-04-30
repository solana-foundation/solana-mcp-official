# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY scripts ./scripts
COPY ingestion/sources.yaml ./ingestion/sources.yaml
COPY lib ./lib
COPY server ./server
RUN pnpm gen:sources \
    && pnpm exec tsc -p tsconfig.json --outDir build \
    && pnpm prune --prod

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "build/server/cloudrun.js"]
# Note: tsc with rootDir=. flattens server/cloudrun.ts → build/server/cloudrun.js
