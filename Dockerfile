FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN mkdir -p /data
ENV DATABASE_PATH=/data/db.json
EXPOSE 3000
CMD ["node", "index.js"]
