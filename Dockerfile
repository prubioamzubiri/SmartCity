FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DB_FILE=/data/smartcity.db CITY_FILE=/app/public/data/city.json PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY server ./server
# El servidor necesita el mapa: ejecuta "npm run fetch-osm" antes de construir la imagen.
COPY public/data/city.json ./public/data/city.json
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
