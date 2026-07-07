FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data
ENV DATABASE_PATH=/data/db.json
CMD ["node", "index.js"]
