FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Persistent data directory (mount Railway volume here)
RUN mkdir -p /data
ENV DATABASE_PATH=/data/spamtrap.json

CMD ["node", "src/index.js"]
