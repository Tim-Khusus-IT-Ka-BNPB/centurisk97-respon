# syntax=docker/dockerfile:1
# Pinned by digest: bump the tag and the digest together.
FROM node:26.13.1-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS base
WORKDIR /app

FROM base AS pnpm
COPY package.json pnpm-lock.yaml .npmrc ./
# Node 26 ships without Corepack, so pnpm comes from npm at the version package.json pins.
# hadolint ignore=DL3016
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" && npm cache clean --force

FROM pnpm AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.app.json tsconfig.node.json react-router.config.ts vite.config.ts vite.server.config.ts ./
COPY app ./app
COPY src ./src
COPY db ./db
COPY public ./public
COPY tools/reference-import ./tools/reference-import
COPY scripts/db ./scripts/db
RUN pnpm build

FROM pnpm AS production-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS runtime
# npm and the packages it bundles only serve the build; removing them keeps their CVEs out of the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY db/migrations ./db/migrations
# The node user that ships in the image, by number, so the host can resolve it.
USER 1000:1000
EXPOSE 3000
# The API takes the client's address from Caddy's header; the check is the container's own.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health', { headers: { 'x-client-address': '127.0.0.1' } }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "build/node/main.js"]
