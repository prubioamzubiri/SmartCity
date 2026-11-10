FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DB_FILE=/data/panel.db PORT=8090
# Sin dependencias: solo la biblioteca estándar de Node (node:sqlite, http, fetch).
COPY metric.js collector.js evaluations.js server.js ./
COPY public ./public
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
