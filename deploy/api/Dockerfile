FROM node:24-slim
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && groupadd -g 10001 dualplate && useradd -u 10001 -g 10001 -r -M dualplate
COPY --chown=10001:10001 api/src ./src
COPY --chown=10001:10001 api/scripts ./scripts
COPY --chown=10001:10001 api/tessdata ./tessdata
USER 10001:10001
EXPOSE 4100
CMD ["node", "src/server.js"]
