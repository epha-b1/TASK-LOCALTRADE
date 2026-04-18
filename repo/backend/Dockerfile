FROM node:20-bookworm-slim
WORKDIR /app
# Debian-slim base: avoids the Alpine-on-some-hosts npm "Exit handler never
# called" intermittent failure that leaves devDeps partially installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg postgresql-client \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
# Retry npm ci and verify that the `tsc` binary is actually installed. npm
# sometimes exits 0 despite partially installing devDeps; verifying a known
# binary guards against that.
RUN set -eu; \
    npm config set fetch-retries 5; \
    npm config set fetch-retry-mintimeout 20000; \
    npm config set fetch-retry-maxtimeout 120000; \
    for i in 1 2 3; do \
      rm -rf node_modules; \
      npm ci --no-audit --no-fund --include=dev --loglevel=error || true; \
      if [ -x node_modules/.bin/tsc ] && [ -x node_modules/.bin/tsx ]; then \
        echo "npm ci succeeded (tsc+tsx present on attempt $i)"; break; \
      fi; \
      echo "attempt $i did not install devDependencies; retrying"; \
      sleep 5; \
    done; \
    test -x node_modules/.bin/tsc; \
    test -x node_modules/.bin/tsx

COPY migrations ./migrations
COPY src ./src
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
