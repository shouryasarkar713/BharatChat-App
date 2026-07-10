// RabbitMQ-backed message queue with graceful fallback to in-memory queue.
//
// In production, set RABBITMQ_URL=amqp://user:pass@rabbitmq:5672 to use RabbitMQ.
// Without it, we fall back to an in-memory queue (single-node only).
//
// The queue handles `persist-message` jobs: writing messages to the DB and
// broadcasting them to socket rooms. With RabbitMQ, multiple chat-service
// instances can all consume from the same queue (work-stealing) and any
// instance can publish — enabling horizontal scaling.

import { Connection, connect, Channel, Message } from 'amqplib'

const QUEUE_NAME = 'pulsechat.message-persist'
const DEAD_LETTER_QUEUE = 'pulsechat.message-persist.dlq'
const MAX_RETRIES = 3

export type QueueJobType = 'persist-message'

export interface QueueJob {
  id: string
  type: QueueJobType
  payload: any
  attempts: number
}

export type JobHandler = (job: QueueJob) => Promise<void>

interface QueueBackend {
  enqueue(job: Omit<QueueJob, 'attempts' | 'id'>): Promise<void>
  start(handler: JobHandler): Promise<void>
  stop(): Promise<void>
  readonly kind: 'rabbitmq' | 'memory'
}

// ---------- RabbitMQ backend ----------
class RabbitMQBackend implements QueueBackend {
  readonly kind = 'rabbitmq' as const
  private conn: Connection | null = null
  private channel: Channel | null = null
  private consumerTag: string | null = null
  private url: string

  constructor(url: string) {
    this.url = url
  }

  async enqueue(job: Omit<QueueJob, 'attempts' | 'id'>): Promise<void> {
    if (!this.channel) await this.connect()
    const fullJob: QueueJob = {
      ...job,
      id: Math.random().toString(36).slice(2),
      attempts: 0,
    }
    // Persistent message: survives RabbitMQ restarts
    this.channel!.sendToQueue(
      QUEUE_NAME,
      Buffer.from(JSON.stringify(fullJob)),
      { persistent: true }
    )
  }

  async start(handler: JobHandler): Promise<void> {
    if (!this.channel) await this.connect()
    // Prefetch 1 — fair dispatch across multiple consumers (horizontal scaling)
    await this.channel!.prefetch(1)
    const consumeResult = await this.channel!.consume(
      QUEUE_NAME,
      async (msg: Message | null) => {
        if (!msg) return
        let job: QueueJob
        try {
          job = JSON.parse(msg.content.toString())
        } catch (e) {
          console.error('[rabbitmq] failed to parse job, nacking (no requeue)', e)
          this.channel!.nack(msg, false, false)
          return
        }
        try {
          await handler(job)
          this.channel!.ack(msg)
        } catch (e) {
          console.error(`[rabbitmq] job ${job.id} failed (attempt ${job.attempts + 1})`, e)
          job.attempts++
          if (job.attempts >= MAX_RETRIES) {
            console.error(`[rabbitmq] job ${job.id} exceeded max retries, sending to DLQ`)
            // Send to DLQ
            this.channel!.sendToQueue(
              DEAD_LETTER_QUEUE,
              Buffer.from(JSON.stringify(job)),
              { persistent: true }
            )
            this.channel!.ack(msg)
          } else {
            // Requeue with exponential backoff (RabbitMQ doesn't natively support
            // delayed requeue; in production use rabbitmq-delayed-message-exchange
            // or a TTL queue. Here we just requeue immediately and rely on prefetch.)
            this.channel!.nack(msg, false, true)
          }
        }
      }
    )
    this.consumerTag = consumeResult.consumerTag
    console.log(`[rabbitmq] consumer started on queue "${QUEUE_NAME}"`)
  }

  async stop(): Promise<void> {
    try {
      if (this.consumerTag && this.channel) {
        await this.channel.cancel(this.consumerTag)
      }
      if (this.channel) await this.channel.close()
      if (this.conn) await this.conn.close()
    } catch {}
    this.channel = null
    this.conn = null
    this.consumerTag = null
  }

  private async connect(): Promise<void> {
    if (this.conn && this.channel) return
    console.log(`[rabbitmq] connecting to ${this.url.replace(/:[^:@]+@/, ':***@')}`)
    this.conn = await connect(this.url)
    this.channel = await this.conn.createChannel()
    // Dead-letter exchange: jobs that exceed retries go here
    await this.channel.assertExchange('pulsechat.dlx', 'direct', { durable: true })
    // Main queue — dead-letters to DLQ
    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'pulsechat.dlx',
        'x-dead-letter-routing-key': 'message-persist',
      },
    })
    await this.channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true })
    await this.channel.bindQueue(DEAD_LETTER_QUEUE, 'pulsechat.dlx', 'message-persist')
    console.log(`[rabbitmq] connected, queue "${QUEUE_NAME}" asserted`)
  }
}

// ---------- In-memory backend (fallback) ----------
class InMemoryBackend implements QueueBackend {
  readonly kind = 'memory' as const
  private queue: QueueJob[] = []
  private running = false
  private handler: JobHandler | null = null
  private processing = false

  async enqueue(job: Omit<QueueJob, 'attempts' | 'id'>): Promise<void> {
    this.queue.push({
      ...job,
      id: Math.random().toString(36).slice(2),
      attempts: 0,
      nextAttemptAt: Date.now(),
    } as any)
    this.process()
  }

  async start(handler: JobHandler): Promise<void> {
    this.handler = handler
    this.running = true
    this.process()
    console.log('[memory-queue] consumer started')
  }

  async stop(): Promise<void> {
    this.running = false
    this.handler = null
  }

  private async process() {
    if (this.processing || !this.running || !this.handler) return
    this.processing = true
    try {
      while (this.queue.length > 0 && this.running) {
        const job = this.queue[0] as QueueJob & { nextAttemptAt?: number }
        if (job.nextAttemptAt && job.nextAttemptAt > Date.now()) {
          await sleep(job.nextAttemptAt - Date.now())
        }
        if (!this.running) break
        this.queue.shift()
        try {
          await this.handler(job)
        } catch (e) {
          console.error(`[memory-queue] job ${job.id} failed (attempt ${job.attempts + 1})`, e)
          job.attempts++
          if (job.attempts < MAX_RETRIES) {
            job.nextAttemptAt = Date.now() + 500 * Math.pow(2, job.attempts)
            this.queue.push(job)
          } else {
            console.error(`[memory-queue] job ${job.id} dropped after ${MAX_RETRIES} attempts`)
          }
        }
      }
    } finally {
      this.processing = false
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}

// ---------- Factory ----------
let backend: QueueBackend | null = null

export async function getQueue(): Promise<QueueBackend> {
  if (backend) return backend
  const url = process.env.RABBITMQ_URL
  if (url) {
    try {
      const mq = new RabbitMQBackend(url)
      // Try to connect eagerly so we fail fast if RabbitMQ is unreachable
      await (mq as any).connect()
      backend = mq
      console.log('[queue] using RabbitMQ backend')
    } catch (e: any) {
      console.warn(`[queue] RabbitMQ connection failed (${e.message}), falling back to in-memory queue`)
      backend = new InMemoryBackend()
      console.log('[queue] using in-memory backend (single-node only)')
    }
  } else {
    backend = new InMemoryBackend()
    console.log('[queue] RABBITMQ_URL not set, using in-memory backend (single-node only)')
  }
  return backend
}
