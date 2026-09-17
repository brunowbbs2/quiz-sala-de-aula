# Imagem única que roda em qualquer hospedagem de container (Render, Koyeb, Fly, Railway...).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1

CMD ["node", "server.js"]
