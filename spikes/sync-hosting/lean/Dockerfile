# Lean candidate: one Node process, one SQLite file, Litestream replicating it to S3-compatible storage (R2).
# Build from the spike root:  docker build -f lean/Dockerfile .
FROM node:24-slim

# Litestream 0.5.18 (released 2026-11-03). The sha256 values are the release's own checksums.txt.
ARG LITESTREAM_VERSION=0.5.18
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && case "${TARGETARCH:-amd64}" in \
      amd64) ARCH=x86_64; SHA=d3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea ;; \
      arm64) ARCH=arm64;  SHA=922a09e6a7ac67f2095571894dc6382e94e1dd4cdd9674883ddf1a8e74ab982d ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/litestream.tgz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz" \
 && echo "${SHA}  /tmp/litestream.tgz" | sha256sum -c - \
 && tar -xzf /tmp/litestream.tgz -C /usr/local/bin litestream \
 && rm /tmp/litestream.tgz

WORKDIR /app
# No npm dependencies at all: node:sqlite and node:http ship with Node.
COPY core ./core
COPY protocol/types.ts protocol/validate.ts protocol/b64.ts ./protocol/
COPY lean ./lean
COPY lean/litestream.yml /etc/litestream.yml
RUN chmod +x lean/entrypoint.sh

ENV DB_PATH=/data/sync.db PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/lean/entrypoint.sh"]
