FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY docker-entrypoint.sh /usr/local/bin/phaseone-entrypoint
RUN chmod 0755 /usr/local/bin/phaseone-entrypoint \
    && mkdir -p /app/data/evidence \
    && chown node:node /app/data/evidence \
    && chmod 0700 /app/data/evidence
ENTRYPOINT ["phaseone-entrypoint"]
EXPOSE 8080
CMD ["node", "dist/server/server/index.js"]
