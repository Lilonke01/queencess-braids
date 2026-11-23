FROM node:24-bookworm-slim

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIRECTORY=/app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
