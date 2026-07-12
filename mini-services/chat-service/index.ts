// Real-time chat micro-service (Socket.io)
// ----------------------------------------------------------------------------
// Responsibilities:
//   1. Real-time message delivery (private + group, via room-per-conversation)
//   2. Presence detection (online/away/offline) with heartbeat timeouts
//   3. Typing indicators
//   4. Read receipts
//   5. Message Queue (RabbitMQ in production, in-memory fallback) for
//      persistence + retry on failure
//   6. Horizontal-scaling ready: Socket.IO Redis adapter + RabbitMQ work queue
//      enable multiple chat-service instances to share load
//
// Authentication: the client passes `userId` + `sessionToken` in the handshake
// auth payload. Currently we accept any userId that exists in the DB. In
// production you would validate the NextAuth JWT here.

import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import { getQueue, QueueJob } from './queue'

const db = new PrismaClient()

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003

// ----------------------------------------------------------------------------
// Presence store: maps userId -> { socketIds: Set, status, lastActiveAt }
// A user can have multiple socket connections (multiple tabs / devices).
// ----------------------------------------------------------------------------
interface PresenceEntry {
  socketIds: Set<string>
  status: 'online' | 'away' | 'offline'
  lastActiveAt: number
}
const presence = new Map<string, PresenceEntry>()

// Heartbeat: mark users as "away" after 60s of no activity, "offline" after 5min.
const AWAY_TIMEOUT = 60 * 1000
const OFFLINE_TIMEOUT = 5 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [userId, entry] of presence) {
    if (entry.socketIds.size === 0) continue
    const idle = now - entry.lastActiveAt
    if (idle > OFFLINE_TIMEOUT) {
      entry.status = 'offline'
    } else if (idle > AWAY_TIMEOUT) {
      entry.status = 'away'
    }
  }
}, 15 * 1000)

// ----------------------------------------------------------------------------
// Message Queue (RabbitMQ with in-memory fallback)
// Jobs: persist-message → write to DB + broadcast to socket room
// ----------------------------------------------------------------------------
async function enqueueMessage(payload: any) {
  const q = await getQueue()
  await q.enqueue({ type: 'persist-message', payload })
}

// Job handler — used by both backends
async function handleJob(job: QueueJob) {
  if (job.type === 'persist-message') {
    const { conversationId, senderId, content, contentType, encrypted, attachment, tempId } = job.payload
    const msg = await db.message.create({
      data: {
        conversationId,
        senderId,
        content,
        contentType,
        encrypted: !!encrypted,
        attachment: attachment ? JSON.stringify(attachment) : null,
      },
      include: {
        sender: { select: { id: true, name: true, username: true, avatarColor: true, avatarUrl: true } },
      },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })

    // Broadcast the persisted (canonical) message to all members in the room.
    const payload = {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      sender: msg.sender,
      content: msg.content,
      contentType: msg.contentType,
      encrypted: msg.encrypted,
      moderation: msg.moderation,
      attachment: msg.attachment ? JSON.parse(msg.attachment) : null,
      deletedAt: msg.deletedAt,
      createdAt: msg.createdAt,
      tempId,
    }
    io.to(`conv:${conversationId}`).emit('message:new', payload)
  }
}

// Start the queue consumer (lazy — initialized on first request, but we kick
// it off eagerly at startup so workers are ready before the first message)
getQueue().then((q) => q.start(handleJob)).catch((e) => {
  console.error('[queue] failed to start consumer', e)
})

// ----------------------------------------------------------------------------
// Socket.IO server
// ----------------------------------------------------------------------------
const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// In production, for horizontal scaling, attach the Redis adapter:
//   import { createAdapter } from '@socket.io/redis-adapter'
//   import { createClient } from 'redis'
//   const pub = createClient({ url: process.env.REDIS_URL })
//   const sub = pub.duplicate()
//   await Promise.all([pub.connect(), sub.connect()])
//   io.adapter(createAdapter(pub, sub))
// This lets multiple Socket.IO nodes broadcast to the same rooms.

interface ClientToServerEvents {
  'user:join': (payload: { userId: string }) => void
  'conversation:join': (payload: { conversationId: string }) => void
  'conversation:leave': (payload: { conversationId: string }) => void
  'message:send': (payload: {
    conversationId: string
    content: string
    contentType?: string
    encrypted?: boolean
    attachment?: any
    tempId?: string
  }) => void
  'message:delete': (payload: { conversationId: string; messageId: string }) => void
  'typing:start': (payload: { conversationId: string }) => void
  'typing:stop': (payload: { conversationId: string }) => void
  'read:receipt': (payload: { conversationId: string; messageId: string }) => void
  'presence:heartbeat': () => void
}

interface ServerToClientEvents {
  'message:new': (payload: any) => void
  'message:deleted': (payload: { conversationId: string; messageId: string; deletedAt: string }) => void
  'typing:start': (payload: { conversationId: string; userId: string; name: string }) => void
  'typing:stop': (payload: { conversationId: string; userId: string }) => void
  'presence:update': (payload: { userId: string; status: 'online' | 'away' | 'offline'; lastActiveAt: number }) => void
  'read:receipt': (payload: { conversationId: string; messageId: string; userId: string }) => void
  'user:authenticated': (payload: { userId: string }) => void
  'error': (payload: { message: string }) => void
}

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  let authenticatedUserId: string | null = null

  socket.on('user:join', async ({ userId }) => {
    if (!userId) {
      socket.emit('error', { message: 'userId required' })
      return
    }
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) {
      socket.emit('error', { message: 'user not found' })
      return
    }
    authenticatedUserId = userId
    socket.join(`user:${userId}`)

    // Initialize / update presence
    let entry = presence.get(userId)
    if (!entry) {
      entry = { socketIds: new Set(), status: 'online', lastActiveAt: Date.now() }
      presence.set(userId, entry)
    }
    entry.socketIds.add(socket.id)
    entry.status = 'online'
    entry.lastActiveAt = Date.now()

    // Update DB lastSeenAt
    await db.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    }).catch(() => {})

    // Auto-join all conversations the user is a member of
    const memberships = await db.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    })
    for (const m of memberships) {
      socket.join(`conv:${m.conversationId}`)
    }

    // Notify the user's conversations that they are online
    for (const m of memberships) {
      socket.to(`conv:${m.conversationId}`).emit('presence:update', {
        userId,
        status: 'online',
        lastActiveAt: entry.lastActiveAt,
      })
    }

    socket.emit('user:authenticated', { userId })
    console.log(`[chat] user joined: ${user.username} (${userId}) — sockets: ${entry.socketIds.size}`)
  })

  socket.on('conversation:join', ({ conversationId }) => {
    if (!authenticatedUserId) return
    socket.join(`conv:${conversationId}`)
  })

  socket.on('conversation:leave', ({ conversationId }) => {
    socket.leave(`conv:${conversationId}`)
  })

  socket.on('message:send', async (payload) => {
    if (!authenticatedUserId) {
      socket.emit('error', { message: 'not authenticated' })
      return
    }
    // Verify membership
    const membership = await db.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: payload.conversationId,
          userId: authenticatedUserId,
        },
      },
    }).catch(() => null)
    if (!membership) {
      socket.emit('error', { message: 'not a member of this conversation' })
      return
    }

    // Enqueue persistence + broadcast (the queue guarantees at-least-once delivery)
    enqueueMessage({
      conversationId: payload.conversationId,
      senderId: authenticatedUserId,
      content: payload.content,
      contentType: payload.contentType || 'TEXT',
      encrypted: payload.encrypted,
      attachment: payload.attachment,
      tempId: payload.tempId,
    })
  })

  socket.on('message:delete', async ({ conversationId, messageId }) => {
    if (!authenticatedUserId) {
      socket.emit('error', { message: 'not authenticated' })
      return
    }
    // Verify the message exists and belongs to the user
    const msg = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversationId: true, deletedAt: true },
    }).catch(() => null)
    if (!msg || msg.conversationId !== conversationId) {
      socket.emit('error', { message: 'message not found' })
      return
    }
    if (msg.senderId !== authenticatedUserId) {
      socket.emit('error', { message: 'you can only delete your own messages' })
      return
    }
    if (msg.deletedAt) {
      // Already deleted — broadcast idempotently
      io.to(`conv:${conversationId}`).emit('message:deleted', {
        conversationId,
        messageId,
        deletedAt: msg.deletedAt.toISOString(),
      })
      return
    }
    await db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    })
    io.to(`conv:${conversationId}`).emit('message:deleted', {
      conversationId,
      messageId,
      deletedAt: new Date().toISOString(),
    })
  })

  socket.on('typing:start', ({ conversationId }) => {
    if (!authenticatedUserId) return
    socket.to(`conv:${conversationId}`).emit('typing:start', {
      conversationId,
      userId: authenticatedUserId,
      name: '', // client already knows the user
    })
  })

  socket.on('typing:stop', ({ conversationId }) => {
    if (!authenticatedUserId) return
    socket.to(`conv:${conversationId}`).emit('typing:stop', {
      conversationId,
      userId: authenticatedUserId,
    })
  })

  socket.on('read:receipt', async ({ conversationId, messageId }) => {
    if (!authenticatedUserId) return
    await db.readReceipt.upsert({
      where: { messageId_userId: { messageId, userId: authenticatedUserId } },
      update: { readAt: new Date() },
      create: { messageId, userId: authenticatedUserId, readAt: new Date() },
    }).catch(() => {})
    await db.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: authenticatedUserId } },
      data: { lastReadAt: new Date() },
    }).catch(() => {})
    socket.to(`conv:${conversationId}`).emit('read:receipt', {
      conversationId,
      messageId,
      userId: authenticatedUserId,
    })
  })

  socket.on('presence:heartbeat', () => {
    if (!authenticatedUserId) return
    const entry = presence.get(authenticatedUserId)
    if (entry) {
      entry.lastActiveAt = Date.now()
      if (entry.status !== 'online') {
        entry.status = 'online'
        // Re-broadcast online status
        for (const room of socket.rooms) {
          if (room.startsWith('conv:')) {
            socket.to(room).emit('presence:update', {
              userId: authenticatedUserId,
              status: 'online',
              lastActiveAt: entry.lastActiveAt,
            })
          }
        }
      }
    }
  })

  socket.on('disconnect', async () => {
    if (!authenticatedUserId) return
    const entry = presence.get(authenticatedUserId)
    if (entry) {
      entry.socketIds.delete(socket.id)
      if (entry.socketIds.size === 0) {
        entry.status = 'offline'
        entry.lastActiveAt = Date.now()
        // Broadcast offline status to all conversations
        const memberships = await db.conversationMember.findMany({
          where: { userId: authenticatedUserId },
          select: { conversationId: true },
        }).catch(() => [])
        for (const m of memberships) {
          io.to(`conv:${m.conversationId}`).emit('presence:update', {
            userId: authenticatedUserId,
            status: 'offline',
            lastActiveAt: entry.lastActiveAt,
          })
        }
        // Update DB lastSeenAt
        await db.user.update({
          where: { id: authenticatedUserId },
          data: { lastSeenAt: new Date() },
        }).catch(() => {})
      }
    }
    console.log(`[chat] socket disconnected: ${socket.id}`)
  })

  socket.on('error', (err) => {
    console.error(`[chat] socket error (${socket.id}):`, err)
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[chat-service] Socket.IO server listening on :${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[chat-service] SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[chat-service] SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})
