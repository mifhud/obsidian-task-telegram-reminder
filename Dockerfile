FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application
COPY dist/ ./dist/
COPY config.json ./

# Create directory for sent-reminders log
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV SENT_LOG_PATH=/app/data/sent-reminders.json

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app
USER nodejs

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
    CMD node -e "console.log('healthy')" || exit 1

# Start the application
CMD ["node", "dist/index.js"]
