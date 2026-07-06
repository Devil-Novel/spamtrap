FROM node:20-slim

# better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Persistent data directory
RUN mkdir -p /data
ENV DATABASE_PATH=/data/spamtrap.sqlite

CMD ["node", "src/index.js"]
