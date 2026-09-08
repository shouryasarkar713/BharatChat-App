# 🇮🇳 BharatChat: Secure Cross-Platform Real-Time Messaging

> 🚀 **Live Web App:** [bharat-chat-app-vqn8.vercel.app](https://bharat-chat-app-vqn8.vercel.app/)  
> 📱 **Android App:** Built with Capacitor, automated CI/CD via GitHub Actions & Firebase App Distribution.

BharatChat is a modern, high-performance, cross-platform messaging application available on **Desktop Web, Mobile Web, and Android**. Built with **Next.js 16 (Turbopack)**, **Tailwind CSS**, **Prisma ORM (PostgreSQL)**, **Socket.IO**, and **Capacitor**, it delivers sub-second messaging with client-side **End-to-End Encryption (E2E)**, encrypted voice notes, burn-on-read timers, and native notifications.

---

## 📱 Cross-Platform Support

BharatChat provides a seamless experience across mobile and desktop environments:

* **Android Native App (`com.bharatchat.app`)**:
  * Native microphone permissions (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`) for in-app voice recording.
  * True native push/local notifications via `@capacitor/local-notifications` with a high-priority "Chat Messages" channel and heads-up banner display.
  * Optimized hardware back-button navigation: pressing back closes full-screen photo previews or dialogs before navigating away from active chats.
  * Native splash screen and dark theme status bar integration.
* **Desktop & Mobile Web**:
  * Progressive Web App (PWA) with install prompts and service worker push notifications.
  * Responsive layout optimized for mobile touchscreens, tablets, and wide-screen desktops.
  * Direct browser permission recovery guidance for blocked notifications.

---

## 🔁 Comprehensive Communication Matrix

Every feature is designed and tested to work symmetrically across all **four communication permutations**:

| Communication Path | Text Messages | Photos & Files | Voice Notes | Burn Timers | Read Receipts |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **App $\rightarrow$ App** (Mobile to Mobile) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **App $\rightarrow$ Web** (Mobile to Desktop) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Web $\rightarrow$ App** (Desktop to Mobile) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Web $\rightarrow$ Web** (Desktop to Desktop) | ✅ | ✅ | ✅ | ✅ | ✅ |

* Verified with a dedicated 59-test suite ensuring zero byte corruption across Indic scripts (**Hindi, Bengali, Tamil, Telugu**), complex emoji sequences (`👨‍👩‍👧‍👦`, `🚀`, `🇮🇳`), and payloads up to 50KB+.

---

## 🎨 Key Features

### 1. 🔐 End-to-End Encryption (E2E) & Privacy
* **Client-Side AES-GCM (256-bit)**: Messages, photos, and voice notes are encrypted in the browser/app before transmission using the Web Crypto API.
* **Deterministic Conversation Keys & RSA-OAEP**: Keys are securely derived per conversation via PBKDF2 with salt, ensuring instant cross-platform synchronization without server access.
* **Zero-Knowledge Architecture**: The server only handles and persists encrypted ciphertexts and authentication tags. Plaintext content is never exposed to the backend.

### 2. 🎙️ High-Fidelity Voice Notes
* Record voice messages with real-time waveform animation and duration timer.
* Voice notes are encrypted client-side and streamed over WebSocket.
* Built-in playback controller with scrubbing, seeking, and playback rate adjustment.
* Native Android OS microphone integration via runtime permission flow.

### 3. ⏳ Self-Destructing / Burn Messages
* Set burn-after-reading timers (**5s, 10s, 30s, 1m, 5m**) for confidential conversations.
* Real-time circular countdown indicator showing remaining seconds.
* Client-server clock skew compensation prevents premature or delayed expiration across devices.
* Automatically deletes from local state and triggers permanent server-side purge upon timer expiration.

### 4. 🔔 Smart Notifications
* **Android**: Uses `@capacitor/local-notifications` with a dedicated notification channel for incoming message alerts. Configured with non-exact alarms to prevent unwanted "Alarms & Reminders" permission prompts.
* **Desktop Web**: Background tab notifications powered by Web Notifications & Service Worker.

### 5. 🛡️ Dynamic Content Safety & Moderation
* **On-Device Profanity Filter**: Recipient client dynamically evaluates content safety at render-time.
* **Scunthorpe Problem Immune**: Word boundaries prevent false positives (e.g., words like *"classic"*, *"pass"*, *"document"*, and *"cocktail"* are always allowed).
* **User Control**: Users can toggle "Show Profanity" on or off in Profile Settings without affecting E2E ciphertexts.

### 6. ⚡ Sub-Second Real-Time Synchronization
* Dedicated **Socket.IO** microservice handling real-time messaging, typing indicators, read receipts, and online/offline presence beacons.
* Smart presence reconciliation on reconnect (`user:join`) ensures contact presence remains accurate across network switches.

---

## 🏗️ System Architecture

```
                                  ┌───────────────────────────────┐
                                  │      Android Mobile App       │
                                  │       (Capacitor Webview)     │
                                  └──────────────┬────────────────┘
                                                 │
  ┌───────────────────────────────┐              │  HTTPS / WSS
  │      Desktop / Mobile Web     │              │  (E2E Encrypted)
  │     (Next.js 16 Turbopack)    │              │
  └──────────────┬────────────────┘              │
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │     Next.js API & Web App     │
                 │           (Port 3000)         │
                 └───────────────┬───────────────┘
                                 │
                   Handshake /   │ WebSockets
                   JWT Session   │ (Port 3003)
                                 ▼
                 ┌───────────────────────────────┐
                 │    Socket.IO Chat Service     │
                 └───────────────┬───────────────┘
                                 │
                   Prisma ORM    │ Queue Persistence
                  (PostgreSQL)   │ (RabbitMQ / In-Memory)
                                 ▼
                 ┌───────────────────────────────┐
                 │      PostgreSQL Database      │
                 └───────────────────────────────┘
```

---

## 💻 Local Setup & Installation

### 📋 Prerequisites
* **Node.js** (v20.x or higher)
* **npm** (v10.x or higher)
* **PostgreSQL** instance (local or hosted, e.g. Neon, Supabase, Railway)
* *(Optional for Android builds)*: **Android Studio** & **Java JDK 21**

---

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/shouryasarkar713/BharatChat-App.git
cd BharatChat-App

# Install dependencies for the main Next.js app
npm install

# Install dependencies for the real-time chat service
cd mini-services/chat-service
npm install
cd ../..
```

---

### Step 2: Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Database Connection (PostgreSQL)
DATABASE_URL="postgresql://postgres:password@localhost:5432/bharatchat"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="super-strong-random-secret-key-32-chars"

# Real-Time Socket Service (Client & Server)
NEXT_PUBLIC_CHAT_SERVICE_URL="http://localhost:3003"
CHAT_SERVICE_URL="http://localhost:3003"
PORT="3003"

# Optional: Remote Capacitor Server URL for testing mobile builds against staging
# CAPACITOR_SERVER_URL="https://bharat-chat-app-vqn8.vercel.app"
```

---

### Step 3: Initialize Database

```bash
# Push Prisma schema to your PostgreSQL database
npm run db:push

# Generate Prisma Client
npm run db:generate
```

---

### Step 4: Run the Application Locally

Start both the frontend web app and the real-time chat service:

```bash
# Terminal 1: Start Next.js frontend (Port 3000)
npm run dev

# Terminal 2: Start Socket.IO Chat Service (Port 3003)
cd mini-services/chat-service
npm run dev
```

Open `http://localhost:3000` in your browser.

---

### Step 5: Seed Test Accounts

Click **"Initialize test accounts"** on the login page (or trigger `POST /api/auth/seed`) to create pre-configured test users:
* **Alice**: `alice@chat.dev` / `password123`
* **Bob**: `bob@chat.dev` / `password123`
* **Carol**: `carol@chat.dev` / `password123`

Log in as Alice in one browser and Bob in another (or Incognito window) to start testing real-time encrypted messaging.

---

## 📱 Mobile App Development (Capacitor & Android)

```bash
# Sync web build and assets with Android project
npm run cap:sync

# Open Android project in Android Studio
npm run cap:android
```

From Android Studio, you can run the app directly on an Android Emulator or physical device connected via USB.

---

## 🧪 Automated Testing Suite

BharatChat includes an extensive test suite covering cryptographic protocols, edge cases, cross-platform communication, moderation, and UI interactions:

```bash
# Run all 9 test suites (59 tests)
npm test

# Run tests in watch mode
npm run test:watch

# Generate code coverage reports
npm run test:coverage
```

### Verified Test Suites:
* `src/__tests__/communication-matrix.test.ts` — Cross-platform encryption/decryption across all 4 permutations (App $\leftrightarrow$ Web), Indic languages, emojis, and large payloads.
* `src/__tests__/crypto.test.ts` — AES-GCM 256-bit key derivation, tamper resistance, and base64 serialization.
* `src/__tests__/encrypted-attachments.test.ts` — Voice note and photo binary encryption/decryption roundtrips.
* `src/__tests__/burn-timer.test.ts` — Countdown timer synchronization, clock skew compensation, and auto-purge.
* `src/__tests__/moderation.test.ts` — Content safety evaluation and Scunthorpe problem immunity.
* `src/__tests__/edge-cases.test.ts` — Malformed payloads, empty inputs, network disconnect recovery.
* `src/__tests__/avatar.test.tsx`, `src/__tests__/theme-toggle.test.tsx`, `src/__tests__/use-mobile.test.ts` — React UI components.

---

## 🚀 CI/CD & Automated Deployment

* **Web Deployment**: Automatically deployed to **Vercel** on every push to `main`.
* **Android APK Pipeline**: Automated via **GitHub Actions** (`.github/workflows/build-apk.yml`):
  1. Installs Node.js & Java JDK 21.
  2. Syncs Capacitor Android assets.
  3. Builds debug APK using Gradle (`./gradlew assembleDebug`).
  4. Uploads build artifact (`BharatChat-debug-apk`).
  5. Automatically deploys to **Firebase App Distribution** for tester distribution.

---

## 📜 License

This project is open source and available under the [MIT License](LICENSE).
