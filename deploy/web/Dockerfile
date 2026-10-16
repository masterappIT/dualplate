FROM node:24-slim AS admin-build
WORKDIR /work/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
ENV VITE_API_BASE_URL=
ENV VITE_CLIENT_LOGIN_URL=https://dualplate.masterappinc.com
RUN npm run build

FROM node:24-slim AS mobile-build
WORKDIR /work/mobile
COPY mobile/package*.json ./
RUN npm ci
COPY mobile/ ./
ENV VITE_API_BASE_URL=
RUN npm run build:h5

FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-build /work/admin/dist /srv/admin
COPY --from=mobile-build /work/mobile/dist/build/h5 /srv/mobile
