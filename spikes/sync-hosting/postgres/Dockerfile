# Postgres candidate: the same Node core, stateless, talking to managed Postgres (Neon) through DATABASE_URL.
# Build from the spike root:  docker build -f postgres/Dockerfile .
FROM node:24-slim
WORKDIR /app
# The one runtime dependency. Keep this version equal to "pg" in package.json (the lockfile is not copied in).
RUN npm install --no-save --no-audit --no-fund --ignore-scripts pg@8.23.1
COPY core ./core
COPY protocol/types.ts protocol/validate.ts protocol/b64.ts ./protocol/
COPY postgres ./postgres
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "postgres/main.ts"]
