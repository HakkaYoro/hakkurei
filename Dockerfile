# Astro standalone (SSR) image for the Hakurei portfolio.
# Run with a volume mounted at /app/data so guestbook/donation data survives restarts.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
# better-sqlite3 needs node-gyp on musl (no prebuilds for alpine)
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
	&& npm ci

COPY . .
RUN npm run build

# Drop dev deps and build toolchain, create the data dir owned by the non-root
# user; su-exec lets the entrypoint drop from root to node at runtime
RUN npm prune --omit=dev \
	&& apk del .build-deps \
	&& apk add --no-cache su-exec \
	&& chmod +x /app/entrypoint.sh \
	&& mkdir -p /app/data \
	&& chown -R node:node /app

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

# Starts as root only to fix a root-owned bind mount on /app/data, then the
# entrypoint drops to `node` for the server itself.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "./dist/server/entry.mjs"]
