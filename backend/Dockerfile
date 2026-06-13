FROM node:18-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

EXPOSE 4000

CMD ["node", "src/server.js"]
