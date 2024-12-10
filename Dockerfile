# Use the official Bun image
FROM oven/bun:latest

# Install Chrome for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for Puppeteer
ENV CHROME_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./ 2>/dev/null || true
COPY bun.lockb ./ 2>/dev/null || true

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Build TypeScript
RUN bun run build

# Command to run the app
CMD ["bun", "src/bot.ts"] 