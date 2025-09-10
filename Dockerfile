# Small production image
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN apk add --no-cache postgresql-client mongodb-tools && \
	npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY .env ./.env
EXPOSE 6000
CMD ["node","src/index.js"]
