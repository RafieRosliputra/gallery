# syntax=docker/dockerfile:1
# Target platform: linux/amd64 (CI builds with `--platform linux/amd64`).
#
# sharp 0.34.5 is pinned because sharp >= 0.35 requires libvips >= 8.18.7 and
# Alpine 3.24 ships 8.18.2. sharp is compiled against the system libvips:
# the npm prebuilt has no HEVC, HEIC decode comes from libheif + libde265.
# libheif-x265 exists so scripts/heic-check can encode a real HEIC in the image.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache \
      vips \
      vips-cpp \
      vips-heif \
      libheif-tools \
      libheif-libde265 \
      libheif-x265 \
      libheif-dav1d

FROM base AS build
RUN apk add --no-cache vips-dev build-base python3
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --build-from-source
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
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
CMD ["node", "apps/server/dist/index.js"]
