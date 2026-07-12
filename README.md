# BharatChat: A Real-Time Messaging Application

> 🚀 **Live Demo:** [bharat-chat-app-vqn8.vercel.app](https://bharat-chat-app-vqn8.vercel.app/)

BharatChat is a premium, modern, and highly secure real-time messaging web application. It features client-side end-to-end encryption (E2E), real-time presence indicators, typing indicators, read receipts, and support for multimedia file attachments.

---

## 🎨 Key Features

1. **End-to-End Encryption (E2E) & Dynamic Content Moderation**
   * Messages are encrypted client-side using **AES-GCM (256-bit)** and keys are exchanged securely using **RSA-OAEP (2048-bit)** via the browser's Web Crypto API.
   * Cryptographic keys are cached locally in **IndexedDB**. The server only stores encrypted ciphertexts and never has access to raw message contents.
   * **Profanity Filter Customization (Option D)**: Users can toggle a "Show Profanity" option in their Profile settings. E2E messages are transmitted uncensored; the recipient client dynamically applies content moderation (`moderateMessage`) at render-time depending on their preference.

2. **Sub-second Real-time Messaging & Presence Sync**
   * Handled by a dedicated **Socket.IO** microservice.
   * Real-time read receipts, dynamic typing indicators, and online/away/offline presence beacons with heartbeat monitoring.
   * **Smart Presence Syncing**: On socket connection (`user:join`), the server queries and synchronizes the active presence status of all members in the user's conversations, resolving partial/one-sided offline status bugs.

3. **Queue-Backed DB Persistence & Binary Upload Storage**
   * The Socket.IO server uses a message queue (backed by **RabbitMQ** with an in-memory fallback) to ensure that incoming messages are written to the database reliably.
   * Failed persistence jobs are automatically retried up to 3 times with exponential backoff before being routed to a Dead-Letter Queue (DLQ).
   * **Stateless Binary Storage**: Files, images, and voice notes are stored as binary buffers (`bytea` / `Bytes` type) directly inside the database, ensuring stateless host compatibility (like Vercel) instead of relying on ephemeral local disk `/tmp` containers.

4. **Rich Multimedia Sharing & High-Accuracy Audio**
   * Upload and share pictures, videos, files, and voice notes.
   * **High-Accuracy Audio Recording**: Decodes recorded WebM audio blobs using `AudioContext` on the client to compute precise track duration in seconds, bypassing browser metadata limitations.

5. **Modern, Responsive UI & Deep Linking**
   * Built with **Next.js**, **Tailwind CSS**, and **shadcn/ui** components.
   * **Deep Link Navigation**: Searching for messages automatically handles chat room transitions, smooth scroll centering, and highlights target messages with a glowing animation.
   * **Premium Typography**: Custom two-tone wordmark ("Bharat" in graphite/ink, "Chat" in marigold) separated by a styled mini speech-bubble logo icon in both the sidebar and auth panels.

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
                      │         PostgreSQL / DB         │
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
   # Database Connection (PostgreSQL)
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bharatchat"

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

1. Apply the database migrations to initialize the schema:
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
