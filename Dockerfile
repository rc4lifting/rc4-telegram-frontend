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

# Copy package files (fixed syntax)
COPY package*.json ./
COPY bun.lockb ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Modify command to show more verbose output
CMD ["bun", "--debug", "src/bot.ts"] 