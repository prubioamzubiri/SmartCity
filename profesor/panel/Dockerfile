# Se construye desde la raíz del repositorio (ver profesor/docker-compose.yml): el panel simula la ciudad sin gestor de
# cada grupo con el mismo motor que el servidor.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DB_FILE=/data/panel.db PORT=8090
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY server/scenario.js ./server/scenario.js
COPY public/data/city.json public/data/municipal.json ./public/data/
COPY profesor/panel ./profesor/panel
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "profesor/panel/server.js"]
