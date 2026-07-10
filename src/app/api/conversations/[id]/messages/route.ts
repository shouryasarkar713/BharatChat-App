import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/conversations/[id]/messages?cursor=<iso>&limit=50
// Returns messages in DESC order (newest first) for infinite scroll.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)

  const messages = await db.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor
      ? {
          skip: 1,
          cursor: { createdAt: new Date(cursor) } as any,
        }
      : {}),
    include: {
      sender: { select: { id: true, name: true, username: true, avatarColor: true, avatarUrl: true } },
    },
  })

  const hasMore = messages.length > limit
  const items = hasMore ? messages.slice(0, limit) : messages
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

  // Mark conversation as read for this user
  await db.conversationMember.update({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
    data: { lastReadAt: new Date() },
  })

  return NextResponse.json({
    messages: items.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      sender: m.sender,
      content: m.content,
      contentType: m.contentType,
      encrypted: m.encrypted,
      moderation: m.moderation,
      attachment: m.attachment ? JSON.parse(m.attachment) : null,
      deletedAt: m.deletedAt,
      createdAt: m.createdAt,
    })),
    nextCursor,
  })
}

// POST /api/conversations/[id]/messages — persist a message that was sent over the socket
// (Used as a fallback / persistence path. The socket service also calls this internally
//  via the same DB client — see mini-services/chat-service/index.ts.)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  const body = await req.json()
  const { content, contentType, encrypted, attachment } = body as {
    content: string
    contentType?: string
    encrypted?: boolean
    attachment?: any
  }

  const msg = await db.message.create({
    data: {
      conversationId: id,
      senderId: user.id,
      content,
      contentType: contentType || 'TEXT',
      encrypted: !!encrypted,
      attachment: attachment ? JSON.stringify(attachment) : null,
    },
    include: {
      sender: { select: { id: true, name: true, username: true, avatarColor: true } },
    },
  })

  // Bump conversation updatedAt so it sorts to the top
  await db.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  })

  return NextResponse.json({
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: msg.sender,
    content: msg.content,
    contentType: msg.contentType,
    encrypted: msg.encrypted,
    moderation: msg.moderation,
    attachment: msg.attachment ? JSON.parse(msg.attachment) : null,
    createdAt: msg.createdAt,
  })
}
