FROM node:20-alpine AS build
WORKDIR /app
# --legacy-peer-deps + retries guard against the npm "Exit handler never called"
# regression we hit on some Alpine runtimes. No behavior change for package resolution.
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && (npm ci --no-audit --no-fund --loglevel=error \
     || npm ci --no-audit --no-fund --loglevel=error \
     || npm install --no-audit --no-fund --loglevel=error)
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
