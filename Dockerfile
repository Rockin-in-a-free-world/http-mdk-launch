FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY openapi ./openapi
RUN npm run build:docs

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["node", "src/server.js"]
