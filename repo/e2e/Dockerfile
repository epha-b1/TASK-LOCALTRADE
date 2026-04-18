FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN set -eu; \
    npm config set fetch-retries 5; \
    npm config set fetch-retry-mintimeout 20000; \
    npm config set fetch-retry-maxtimeout 120000; \
    for i in 1 2 3; do \
      rm -rf node_modules; \
      npm install --no-audit --no-fund --include=dev --loglevel=error || true; \
      if [ -x node_modules/.bin/vitest ]; then \
        echo "npm install succeeded (vitest present on attempt $i)"; break; \
      fi; \
      echo "attempt $i did not install vitest; retrying"; \
      sleep 5; \
    done; \
    test -x node_modules/.bin/vitest
COPY vitest.config.ts ./
COPY e2e.test.ts ./
CMD ["npm", "test"]
