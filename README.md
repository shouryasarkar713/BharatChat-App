# BharatChat: A Real-Time Messaging Application

BharatChat is a premium, modern, and highly secure real-time messaging web application. It features client-side end-to-end encryption (E2E), real-time presence indicators, typing indicators, read receipts, and support for multimedia file attachments.

---

## 🎨 Key Features

1. **End-to-End Encryption (E2E)**
   * Messages are encrypted client-side using **AES-GCM (256-bit)** and keys are exchanged securely using **RSA-OAEP (2048-bit)** via the browser's Web Crypto API.
   * Cryptographic keys are cached locally in **IndexedDB**. The server only stores encrypted ciphertexts and never has access to raw message contents.
2. **Sub-second Real-time Messaging**
   * Handled by a dedicated **Socket.IO** microservice.
   * Real-time read receipts, dynamic typing indicators, and online/away/offline presence beacons with heartbeat monitoring.
3. **Queue-Backed DB Persistence**
   * The Socket.IO server uses a message queue (backed by **RabbitMQ** with an in-memory fallback) to ensure that incoming messages are written to the database reliably.
   * Failed persistence jobs are automatically retried up to 3 times with exponential backoff before being routed to a Dead-Letter Queue (DLQ).
4. **Rich Multimedia Sharing**
   * Upload and share pictures, videos, files, and voice notes.
   * Includes built-in image previewing, video streaming, file download links, and an in-app audio recorder and player.
5. **Modern, Responsive UI**
   * Built with **Next.js**, **Tailwind CSS**, and **shadcn/ui** components.
   * Features a premium Indigo and Warm Saffron color theme, glassmorphic layout panels, asymmetric message bubbles, and smooth framer-motion micro-animations.

---

## 🏗️ Project Architecture

```
                      ┌─────────────────────────────────┐
                      │    Next.js Frontend / API       │
                      │          (Port 3000)            │
                      └────────────────┬────────────────┘
                                       │
                        Handshake /    │ WebSockets
                        NextAuth JWT   │ (Port 3003)
                                       ▼
                      ┌─────────────────────────────────┐
                      │    Socket.IO Chat Service       │
                      └────────────────┬────────────────┘
                                       │
                    RabbitMQ /         │ Database writes
                    Memory Queue       │ (Prisma ORM)
                                       ▼
                      ┌─────────────────────────────────┐
                      │         SQLite / DB             │
                      └─────────────────────────────────┘
```

---

## 💻 Local Setup & Installation

Follow these steps to configure and run BharatChat locally on your laptop:

### 📋 Prerequisites
* **Node.js** (v18.x or higher)
* **npm** (v9.x or higher) or **Bun**

---

### Step 1: Clone and Install Dependencies

1. Clone this repository to your local machine:
   ```bash
   git clone <your-repo-url>
   cd bharatchat
   ```
2. Install dependencies for the main Next.js application:
   ```bash
   npm install
   ```
3. Install dependencies for the real-time chat service:
   ```bash
   cd mini-services/chat-service
   npm install
   cd ../..
   ```

---

### Step 2: Configure Environment Variables

1. Create a `.env` file in the root of the project:
   ```env
   # Database Connection (SQLite by default)
   DATABASE_URL="file:./db/custom.db"

   # NextAuth Settings
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="any-super-strong-32-character-secret-string"
   ```
   *(Note: You can generate a random secret using `openssl rand -base64 32`)*

2. (Optional) If you want to run RabbitMQ for queue persistence, set `RABBITMQ_URL` in the environment:
   ```env
   RABBITMQ_URL="amqp://guest:guest@localhost:5672"
   ```
   *If `RABBITMQ_URL` is omitted, the chat service automatically falls back to a robust in-memory queue.*

---

### Step 3: Setup the Database

1. Apply the database migrations to initialize SQLite:
   ```bash
   npx prisma db push
   ```
2. Generate the Prisma Client:
   ```bash
   npx prisma generate
   ```

---

### Step 4: Run the Application

You need to run both the Next.js frontend and the Socket.IO chat service:

1. **Start the Next.js App** (from the project root):
   ```bash
   npm run dev
   ```
   This will start the frontend web app on `http://localhost:3000`.

2. **Start the Chat Service** (from the chat-service directory):
   ```bash
   cd mini-services/chat-service
   npm run dev
   ```
   This will start the Socket.IO server on `http://localhost:3003`.

---

### Step 5: Initialize Test Accounts

1. Open your browser and navigate to `http://localhost:3000`.
2. Under the login form, click **Initialize test accounts** (or trigger a POST request to `/api/auth/seed`). This will seed three pre-configured accounts:
   * **Alice**: `alice@chat.dev` / `password123`
   * **Bob**: `bob@chat.dev` / `password123`
   * **Carol**: `carol@chat.dev` / `password123`
3. You can log in as Alice in one browser window and Bob in another (e.g. Incognito) to start exchanging encrypted, real-time messages!

---

### Step 6: Run tests and coverage

The project contains a Jest and React Testing Library suite covering core utility libraries (cryptography, content moderation), React hooks, and UI components:

1. **Run all tests**:
   ```bash
   npm run test
   ```
2. **Generate test coverage reports**:
   ```bash
   npm run test:coverage
   ```
   Interactive HTML reports can be viewed under the `/coverage/lcov-report/index.html` directory.

---

## 🚀 Scaling for Production (RabbitMQ & Redis)

For production environments requiring horizontal scaling across multiple chat servers:

1. **Queue (RabbitMQ)**:
   Ensure a RabbitMQ instance is running (e.g. via Docker):
   ```bash
   docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
   ```
   Provide the `RABBITMQ_URL` env variable to the chat service before launching.

2. **Socket.IO Broadcast (Redis)**:
   Run a Redis container:
   ```bash
   docker run -d --name redis -p 6379:6379 redis:7
   ```
   Install the Redis adapter dependencies:
   ```bash
   cd mini-services/chat-service
   npm install @socket.io/redis-adapter redis
   ```
   Uncomment the Redis adapter configuration code in `mini-services/chat-service/index.ts` (lines 120-126) to allow multi-node room communication.
