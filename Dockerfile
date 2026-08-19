FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY templates ./templates
COPY openrpc ./openrpc

EXPOSE 8080

CMD ["node", "src/server.js"]
