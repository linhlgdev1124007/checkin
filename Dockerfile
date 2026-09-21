FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN groupadd --system checkin && useradd --system --gid checkin --home-dir /app checkin
COPY --from=build --chown=checkin:checkin /app/package.json ./package.json
COPY --from=build --chown=checkin:checkin /app/node_modules ./node_modules
COPY --from=build --chown=checkin:checkin /app/dist ./dist
USER checkin
EXPOSE 3000
CMD ["node", "dist/server/server/index.js"]

