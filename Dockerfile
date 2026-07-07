FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data
ENV DATABASE_PATH=/data/db.json
EXPOSE 3000
CMD ["node", "index.js"]
