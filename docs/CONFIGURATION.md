# PulseChat — Configuration Guide

## Environment Variables

### Main App (Next.js)

Create a `.env` file in the project root:

```bash
# Database (SQLite by default)
DATABASE_URL=file:/home/z/my-project/db/custom.db

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secret-string-here
```

Generate a strong `NEXTAUTH_SECRET`:
```bash
openssl rand -base64 32
```

### Chat Service (Socket.IO mini-service)

The chat service runs on port 3003. Configure RabbitMQ by setting `RABBITMQ_URL`:

```bash
# Without RabbitMQ (default — uses in-memory queue, single-node only)
# Leave RABBITMQ_URL unset

# With RabbitMQ (production — enables horizontal scaling)
RABBITMQ_URL=amqp://username:password@rabbitmq-host:5672
```

## Enabling RabbitMQ in Production

### 1. Run RabbitMQ

The easiest way is via Docker:

```bash
docker run -d \
  --name pulsechat-rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=pulsechat \
  -e RABBITMQ_DEFAULT_PASS=your-password \
  --restart unless-stopped \
  rabbitmq:3-management
```

This exposes:
- AMQP on port 5672 (for the chat service to connect)
- Management UI on port 15672 (admin interface, login with `pulsechat` / `your-password`)

### 2. Configure the chat service

Set `RABBITMQ_URL` before starting the chat service:

```bash
export RABBITMQ_URL=amqp://pulsechat:your-password@localhost:5672
bun run dev
```

Or in the `scripts/start-chat-service.sh` script:

```bash
RABBITMQ_URL=amqp://pulsechat:your-password@localhost:5672 \
  setsid nohup /usr/local/bin/bun index.ts \
  > log.txt 2>&1 < /dev/null &
```

### 3. Verify it's working

When the chat service starts, you should see:

```
[rabbitmq] connecting to amqp://pulsechat:***@localhost:5672
[rabbitmq] connected, queue "pulsechat.message-persist" asserted
[rabbitmq] consumer started on queue "pulsechat.message-persist"
[chat-service] Socket.IO server listening on :3003
[queue] using RabbitMQ backend
```

If RabbitMQ is unreachable, the service automatically falls back to the in-memory queue:

```
[queue] RabbitMQ connection failed (ECONNREFUSED), falling back to in-memory queue
[queue] using in-memory backend (single-node only)
```

## How RabbitMQ enables Horizontal Scaling

### Architecture

```
                    ┌─────────────────┐
                    │   RabbitMQ      │
                    │  (work queue)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐         ┌──────────┐
  │ chat-svc │         │ chat-svc │         │ chat-svc │
  │  node 1  │         │  node 2  │         │  node 3  │
  │  :3003   │         │  :3004   │         │  :3005   │
  └────┬─────┘         └────┬─────┘         └────┬─────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────┴────────┐
                    │   Socket.IO    │
                    │ Redis adapter  │
                    │  (broadcast)   │
                    └────────────────┘
```

### How it works

1. **Any chat-service node can receive a `message:send` event** from a connected client.
2. **That node enqueues a `persist-message` job** to RabbitMQ.
3. **Exactly one node picks up the job** (RabbitMQ's `prefetch: 1` enables fair dispatch / work-stealing).
4. **That node writes the message to the shared database** and broadcasts it to its locally-connected clients.
5. **To broadcast to clients connected to other nodes**, the Socket.IO Redis adapter is used (see the commented-out code in `index.ts`).

### Setting up multi-node

1. Run RabbitMQ (see above)
2. Run Redis:
   ```bash
   docker run -d --name pulsechat-redis -p 6379:6379 redis:7
   ```
3. Uncomment the Redis adapter code in `mini-services/chat-service/index.ts`:
   ```ts
   import { createAdapter } from '@socket.io/redis-adapter'
   import { createClient } from 'redis'
   const pub = createClient({ url: process.env.REDIS_URL })
   const sub = pub.duplicate()
   await Promise.all([pub.connect(), sub.connect()])
   io.adapter(createAdapter(pub, sub))
   ```
4. Install the adapter:
   ```bash
   cd mini-services/chat-service
   bun add @socket.io/redis-adapter redis
   ```
5. Start multiple chat-service instances on different ports (each with a unique `PORT` env var override in `index.ts`).
6. Update Caddy to load-balance across them.

## Queue Topology

- **Exchange:** `pulsechat.dlx` (direct, durable) — dead-letter exchange
- **Queue:** `pulsechat.message-persist` (durable, dead-letters to DLX)
  - Args: `x-dead-letter-exchange=pulsechat.dlx`, `x-dead-letter-routing-key=message-persist`
- **Queue:** `pulsechat.message-persist.dlq` (durable) — dead-letter queue for failed jobs
  - Bound to `pulsechat.dlx` with routing key `message-persist`

### Retry behavior

- Max retries per job: **3**
- Retry strategy:
  - In-memory: exponential backoff (500ms × 2^attempts)
  - RabbitMQ: immediate requeue (for delayed retries, install `rabbitmq-delayed-message-exchange` plugin)
- After max retries, jobs are sent to the DLQ for manual inspection

## Inspecting the Queue

### RabbitMQ Management UI

Visit `http://localhost:15672` (login with your RabbitMQ credentials):
- **Queues tab:** See `pulsechat.message-persist` and `pulsechat.message-persist.dlq`
- **Messages Ready:** Number of jobs waiting to be processed
- **Messages Unacknowledged:** Jobs currently being processed
- **Publish / Get messages:** Manually publish or inspect messages

### CLI

```bash
# List queues
rabbitmqctl list_queues name messages messages_ready messages_unacknowledged

# List bindings
rabbitmqctl list_bindings

# Purge the queue (careful!)
rabbitmqctl purge_queue pulsechat.message-persist
```
