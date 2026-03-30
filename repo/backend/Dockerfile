FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg postgresql-client
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY migrations ./migrations
COPY src ./src
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
