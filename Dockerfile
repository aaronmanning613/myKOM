# The production image: the API serving the built web app (one image, one origin).
# Run it with the production env (see docs/deploy.md); it listens on $PORT (Cloud Run sets it).

FROM node:22-slim AS build
# No TTY here, so pnpm may replace node_modules when pruning to production dependencies.
ENV CI=true
RUN corepack enable
WORKDIR /app
# Manifests first, so the dependency layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm install --prod --frozen-lockfile --offline

FROM node:22-slim
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "--conditions=mykom-dist", "dist/server.js"]
