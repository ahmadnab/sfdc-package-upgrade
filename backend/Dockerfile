# Use official Playwright image with Chromium
FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directories for data persistence
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port (Cloud Run uses 8080 by default)
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]