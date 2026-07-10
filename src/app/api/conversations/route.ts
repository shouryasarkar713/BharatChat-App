import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/conversations — list conversations the current user is a member of
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const memberships = await db.conversationMember.findMany({
    where: { userId: user.id },
    include: {
      conversation: {
        include: {
          members: { include: { user: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { conversation: { updatedAt: 'desc' } },
  })

  const conversations = memberships.map((m) => {
    const conv = m.conversation
    const otherMembers = conv.members.filter((mm) => mm.userId !== user.id)
    const displayName =
      conv.type === 'GROUP'
        ? conv.name || 'Untitled Group'
        : otherMembers[0]?.user.name || 'Direct'
    return {
      id: conv.id,
      type: conv.type,
      name: displayName,
      avatarColor: conv.avatarColor,
      members: conv.members.map((mm) => ({
        id: mm.user.id,
        name: mm.user.name,
        username: mm.user.username,
        avatarColor: mm.user.avatarColor,
        avatarUrl: mm.user.avatarUrl,
        role: mm.role,
      })),
      lastMessage: conv.messages[0]
        ? {
            id: conv.messages[0].id,
            content: conv.messages[0].content,
            contentType: conv.messages[0].contentType,
            encrypted: conv.messages[0].encrypted,
            senderId: conv.messages[0].senderId,
            deletedAt: conv.messages[0].deletedAt,
            createdAt: conv.messages[0].createdAt,
          }
        : null,
      lastReadAt: m.lastReadAt,
      updatedAt: conv.updatedAt,
    }
  })

  return NextResponse.json({ conversations })
}

// POST /api/conversations — create a new conversation (PRIVATE or GROUP)
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { type, name, memberIds, avatarColor } = body as {
    type: 'PRIVATE' | 'GROUP'
    name?: string
    memberIds: string[]
    avatarColor?: string
  }

  if (!type || !Array.isArray(memberIds) || memberIds.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const allMemberIds = Array.from(new Set([user.id, ...memberIds]))

  // For PRIVATE conversations, dedupe against an existing one with the same two members.
  if (type === 'PRIVATE' && allMemberIds.length === 2) {
    const existing = await db.conversation.findFirst({
      where: {
        type: 'PRIVATE',
        members: { every: { userId: { in: allMemberIds } } },
      },
      include: { members: true },
    })
    if (existing && existing.members.length === 2) {
      return NextResponse.json({ id: existing.id, existing: true })
    }
  }

  const conv = await db.conversation.create({
    data: {
      type,
      name: type === 'GROUP' ? name || 'New Group' : null,
      avatarColor: avatarColor || '#0ea5e9',
      createdBy: user.id,
      members: {
        create: allMemberIds.map((uid) => ({
          userId: uid,
          role: uid === user.id ? 'OWNER' : 'MEMBER',
        })),
      },
    },
  })

  return NextResponse.json({ id: conv.id, existing: false })
}
