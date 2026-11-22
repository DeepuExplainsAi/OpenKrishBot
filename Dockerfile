# OpenKrishBot as a server: docker compose up -d, then scripts/sign-in-link.sh inside the container.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl openssl chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=8787 CHROME_PATH=/usr/bin/chromium HOME=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "server/dist/index.js"]
