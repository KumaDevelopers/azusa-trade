FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server/relay.mjs server/twelve-stream.mjs ./server/
COPY --chown=node:node lib/instruments.mjs ./lib/
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server/relay.mjs"]
