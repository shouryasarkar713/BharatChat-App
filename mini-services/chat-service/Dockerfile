FROM node:20-alpine
WORKDIR /app

# Copy root configurations and prisma schema
COPY package*.json ./
COPY prisma ./prisma

# Install root dependencies
RUN npm install

# Copy chat-service package configs
COPY mini-services/chat-service/package*.json ./mini-services/chat-service/

# Install chat-service dependencies
WORKDIR /app/mini-services/chat-service
RUN npm install

# Generate Prisma Client in the root node_modules
WORKDIR /app
RUN npx prisma generate

# Copy the rest of the workspace files
COPY . .

# Expose Socket.IO port
EXPOSE 3003

# Run service
WORKDIR /app/mini-services/chat-service
CMD ["npx", "tsx", "index.ts"]
