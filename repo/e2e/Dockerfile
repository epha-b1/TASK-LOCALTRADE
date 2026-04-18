FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && (npm install --no-audit --no-fund --loglevel=error \
     || npm install --no-audit --no-fund --loglevel=error)
COPY vitest.config.ts ./
COPY e2e.test.ts ./
CMD ["npm", "test"]
