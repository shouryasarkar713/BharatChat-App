FROM node:20-alpine
WORKDIR /app

# Copy root configurations and prisma schema
COPY package*.json ./
COPY prisma ./prisma

# Install all workspace dependencies
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy chat service code
COPY mini-services/chat-service ./mini-services/chat-service

# Expose Socket.IO port
EXPOSE 3003

# Run service
WORKDIR /app/mini-services/chat-service
CMD ["npx", "tsx", "index.ts"]
