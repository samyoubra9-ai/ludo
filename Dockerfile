FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
RUN mkdir -p dist
COPY dist ./dist
EXPOSE 8787
CMD ["node", "server/index.mjs"]
