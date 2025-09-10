# Small production image
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY .env ./.env
EXPOSE 3000
CMD ["node","src/index.js"]
