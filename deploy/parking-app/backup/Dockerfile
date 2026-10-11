# syntax=docker/dockerfile:1.7
# Nightly pg_dump → S3-compatible storage (rclone), 14-day retention, plus restore and restore-verify.
# Runtime uses the same PostGIS image as the database, so pg_dump/pg_restore match the server version exactly.
# rclone is fetched and checksum-verified in a separate stage: the PostGIS image is Debian 11, whose apt
# archives have moved, so nothing is apt-installed at runtime.
ARG NODE_IMAGE=node:22.23.3-bookworm-slim
ARG PG_IMAGE=postgis/postgis:16-3.5

FROM ${NODE_IMAGE} AS rclone
ARG RCLONE_VERSION=1.68.2
ARG RCLONE_SHA256_AMD64=ee138bbc507deb8d2a854aec1a5128e5de0a4069102f2a4a17e62d80e45b0eb2
ARG RCLONE_SHA256_ARM64=1442926e1fd803fd7c01903c8b936c9a0c22c5871a0c164a6c6c61da5fe0ba27
# Optional build secret "ca" for builds behind a TLS-inspecting proxy; not kept in any image.
RUN --mount=type=secret,id=ca,required=false set -eu; \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) sum="$RCLONE_SHA256_AMD64";; arm64) sum="$RCLONE_SHA256_ARM64";; *) echo "unsupported arch $arch"; exit 1;; esac; \
    URL="https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-${arch}.deb" node -e \
      'fetch(process.env.URL).then(async r=>{if(!r.ok)throw new Error(r.status);require("fs").writeFileSync("/tmp/rclone.deb",Buffer.from(await r.arrayBuffer()))}).catch(e=>{console.error(e);process.exit(1)})'; \
    echo "${sum}  /tmp/rclone.deb" | sha256sum -c -; \
    dpkg-deb -x /tmp/rclone.deb /tmp/rclone; \
    install -m 0755 /tmp/rclone/usr/bin/rclone /usr/local/bin/rclone

FROM ${PG_IMAGE}
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
RUN mkdir -p /var/lib/backup && chown postgres:postgres /var/lib/backup
USER postgres
WORKDIR /var/lib/backup
# Unhealthy when no backup has succeeded for 26 h (counting from container start until the first one).
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s CMD ["/usr/local/bin/backup.sh", "health"]
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
