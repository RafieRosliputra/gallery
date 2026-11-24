# syntax=docker/dockerfile:1
# Target platform: linux/amd64 (CI builds with `--platform linux/amd64`).
#
# sharp ships prebuilt libvips binaries for both glibc and musl: no system
# libvips, libheif, libde265 or x265, and no source build. The runtime image is
# therefore Debian slim with no image libraries installed at all.
# Only JPEG and WebP loaders are enabled at runtime (apps/server/src/scan/image-policy.ts).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY db ./db
COPY scripts ./scripts
RUN chmod -R a+rX /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/server/dist/migrate-cli.js && node apps/server/dist/index.js"]
