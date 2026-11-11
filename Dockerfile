# One image = the whole site: builds the web app, then the API serves it. Works on any Docker host.
FROM node:22-alpine AS web
WORKDIR /app
COPY shared ./shared
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY shared ./shared
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY --from=web /app/client/dist ./client/dist
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
WORKDIR /app/server
ENV UPLOAD_DIR=/data/uploads PORT=5000
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "src/server.js"]
