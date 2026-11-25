# Build the offline asset index without downloading application dependencies.
FROM node:22-alpine AS prepare
WORKDIR /build
COPY dist ./dist
COPY scripts/build-precache.mjs ./scripts/build-precache.mjs
RUN node scripts/build-precache.mjs

# Caddy serves static files and issues a private LAN HTTPS certificate.
FROM caddy:2.11.9-alpine
COPY --from=prepare /build/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
RUN mkdir -p /data /config && chown -R 1000:1000 /data /config
USER 1000:1000
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
