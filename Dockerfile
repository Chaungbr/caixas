FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production
# O banco fica em /data — monte um volume persistente nesse caminho.
ENV CAIXAS_DATA=/data
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
