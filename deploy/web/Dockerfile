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
# App 下載頁：圖示動畫沿用客戶端啟動頁的分層 SVG，網頁圖示沿用客戶端的
COPY deploy/web/download /srv/download
COPY mobile/src/static/launch /srv/download/launch
COPY mobile/src/static/web/favicon.ico mobile/src/static/web/apple-touch-icon.png /srv/download/
