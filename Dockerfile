# Astro standalone (SSR) image for the Hakurei portfolio.
# Run with a volume mounted at /app/data so guestbook/donation data survives restarts.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev deps, create the data dir owned by the non-root user
RUN npm prune --omit=dev \
	&& mkdir -p /app/data \
	&& chown -R node:node /app

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

USER node
CMD ["node", "./dist/server/entry.mjs"]
