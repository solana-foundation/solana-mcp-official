FROM node:20-alpine

RUN corepack enable \
    && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* package-lock.json* .npmrc* ./

RUN pnpm install --frozen-lockfile

COPY . .

ENV PORT=3001

EXPOSE 3001

CMD ["pnpm", "start"]